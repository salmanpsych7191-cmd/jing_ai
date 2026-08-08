import OpenAI from 'openai';
import { ENV } from '../../config/env';
import { voicePromptBlock } from '../../knowledge';
import { VOICE_TOOLS } from '../../whatsapp/tools';
import { executeToolCall, stripLeakedFunctionSyntax, mentionsTransferIntent } from '../../whatsapp/toolExecutor';

// Voice calls stay on Cerebras, not reverted to Groq: Groq's Developer Tier is
// platform-wide unavailable and llama-3.1-8b-instant shares its free-tier rate-limit
// pool with the WhatsApp bot, which caused real dropped call turns in production
// testing earlier this session. Kept provider-switchable via env var for parity with
// the Python app's rollback mechanism, in case Groq's Dev Tier ever comes back.
const useCerebras = ENV.voiceLlmProvider === 'cerebras' && ENV.cerebrasApiKey;
export const voiceClient = new OpenAI({
  apiKey: useCerebras ? ENV.cerebrasApiKey : ENV.groqApiKey,
  baseURL: useCerebras ? 'https://api.cerebras.ai/v1' : 'https://api.groq.com/openai/v1',
  maxRetries: 0,
  timeout: 8000,
});

export type VoiceMessage = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; [key: string]: any };

function buildVoiceSystemPrompt(phone: string, outboundPurpose: string | null): string {
  const today = new Date();
  const outboundBlock = outboundPurpose
    ? `
This call was placed BY the restaurant TO this person. The greeting has already been spoken (see conversation history) — do NOT re-introduce yourself or repeat why you're calling. The reason for this call: ${outboundPurpose}.
Pick up from where the greeting left off: respond to what the person just said and guide the conversation toward ${outboundPurpose} (e.g. confirming interest, proposing next steps, or collecting booking details) — warm and conversational, not pushy. Once the purpose has been addressed, answer questions normally.
`
    : '';

  return `
You are the phone host for ${ENV.restaurantName}, a halal Chinese hotpot & grill buffet in Singapore.
Today is ${today.toDateString()}. The caller's phone number is already known (${phone}) — never ask for it.
You are speaking on a live phone call, not chatting on text. Talk like a warm, genuinely friendly host who
loves this restaurant — not like a script being read out.
${outboundBlock}
Rules for spoken responses:
- Sound like a real person on the phone: use natural warmth ("Of course!", "Happy to help with that", "Great choice!"),
  react to what the caller says instead of just answering flatly, and let a bit of enthusiasm for the food come through.
- Be interactive, not just a Q&A machine — ask a natural follow-up when it fits ("Any occasion we should know about?",
  "Would you like a spicier mala or something milder?") instead of only answering exactly what was asked.
- Plain spoken sentences only. No markdown, no bullet points, no numbered lists, no emoji.
- Keep replies conversational-length — usually 1-3 sentences, like an actual phone call, not a monologue and not a
  curt one-liner either. Warmth can take a few extra words; don't pad with filler that doesn't add anything.
- Callers may speak Singlish or mix in local phrasing — respond naturally and don't comment on their accent or phrasing.
- If you mishear something or aren't confident what was said, ask a short clarifying question instead of guessing.

${voicePromptBlock()}

Guidelines:
- Never invent menu items, prices, or hours — only use the facts above.
- Use tools for anything involving real bookings, availability, loyalty points, or the review link.
- Before calling create_reservation, confirm guest name, date, time, and party size out loud, and get a clear yes.
- If you already confirmed this exact booking earlier in the call, do not call create_reservation again.
- Call transfer_to_staff if the caller asks for a person, has a request you can't handle, or seems frustrated.
- For group bookings, private events, or large parties: call transfer_to_staff (this also automatically texts staff the caller's number as a backup) and tell the caller you're connecting them now.
- Never read a URL aloud. If the caller wants the menu, a review link, or a social media page, use the send_link tool to text it to them and say something like "I've just sent that to your WhatsApp."
- Never claim you did something you didn't. Only say you're transferring the call if you actually called transfer_to_staff this turn; only say you sent a link if you actually called send_link this turn.
`.trim();
}

// Abbreviations whose period must never be treated as a sentence boundary.
const ABBREV_RE = /\b(Dr|Mr|Mrs|Ms|Prof|St|No|vs|etc)\./gi;
const PLACEHOLDER = '\x00';

interface ToolCallFragment { id: string; name: string; arguments: string }

async function consumeVoiceStream(
  stream: AsyncIterable<any>,
  onSentence: (sentence: string) => void,
): Promise<{ contentBuffer: string; toolCalls: ToolCallFragment[] }> {
  let contentBuffer = '';
  let sentenceBuffer = '';
  const fragments: Record<number, ToolCallFragment> = {};

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const frag = fragments[tc.index] ?? { id: '', name: '', arguments: '' };
        if (tc.id) frag.id = tc.id;
        if (tc.function?.name) frag.name += tc.function.name;
        if (tc.function?.arguments) frag.arguments += tc.function.arguments;
        fragments[tc.index] = frag;
      }
    }
    if (delta?.content) {
      contentBuffer += delta.content;
      sentenceBuffer += delta.content;

      const safe = sentenceBuffer.replace(ABBREV_RE, (_m, abbr) => abbr + PLACEHOLDER);
      const parts = safe.split(/([.!?])\s/);
      while (parts.length >= 3 && Object.keys(fragments).length === 0) {
        const text = parts.shift()!;
        const punct = parts.shift()!;
        const sentence = (text + punct).replace(new RegExp(PLACEHOLDER, 'g'), '.').trim();
        if (sentence) onSentence(sentence);
      }
      sentenceBuffer = parts.join('').replace(new RegExp(PLACEHOLDER, 'g'), '.');
    }
  }

  if (Object.keys(fragments).length === 0) {
    const remaining = sentenceBuffer.trim();
    if (remaining) onSentence(remaining);
  }

  return { contentBuffer, toolCalls: Object.keys(fragments).sort((a, b) => +a - +b).map((k) => fragments[+k]) };
}

export interface VoiceTurnResult {
  reply: string;
  shouldTransfer: boolean;
}

/**
 * Runs one voice conversation turn, streaming the final spoken reply sentence-by-
 * sentence via onSentence as the LLM generates it, so TTS can start before the model
 * has finished writing. Tool-calling rounds (create_reservation, etc.) resolve as a
 * whole first, exactly like the WhatsApp agent - a function call can't be split into
 * speech, so only the final plain-text reply streams.
 */
export async function streamVoiceAgentTurn(
  phone: string,
  text: string,
  history: VoiceMessage[],
  outboundPurpose: string | null,
  onSentence: (sentence: string) => void,
): Promise<VoiceTurnResult> {
  const systemPrompt = buildVoiceSystemPrompt(phone, outboundPurpose);
  const messages: any[] = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }];
  let shouldTransfer = false;

  for (let round = 0; round < 4; round++) {
    let contentBuffer = '';
    let toolCalls: ToolCallFragment[] = [];
    const roundStart = Date.now();
    try {
      console.log(`Voice LLM round ${round} starting (model=${ENV.voiceLlmModel})`);
      const stream = await voiceClient.chat.completions.create({
        model: ENV.voiceLlmModel,
        messages,
        tools: VOICE_TOOLS as any,
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 150,
        stream: true,
      });
      console.log(`Voice LLM round ${round}: stream object received after ${Date.now() - roundStart}ms, consuming...`);
      ({ contentBuffer, toolCalls } = await consumeVoiceStream(stream as any, onSentence));
      console.log(`Voice LLM round ${round}: done after ${Date.now() - roundStart}ms, contentLen=${contentBuffer.length} toolCalls=${toolCalls.length}`);
    } catch (err) {
      console.warn('Voice completion stream failed, retrying once:', err);
      try {
        const stream = await voiceClient.chat.completions.create({
          model: ENV.voiceLlmModel,
          messages,
          tools: VOICE_TOOLS as any,
          tool_choice: 'auto',
          temperature: 0.4,
          max_tokens: 150,
          stream: true,
        });
        ({ contentBuffer, toolCalls } = await consumeVoiceStream(stream as any, onSentence));
      } catch (retryErr) {
        console.warn('Voice completion stream failed again, giving up this turn:', retryErr);
        const fallback = "Sorry, I'm having a little trouble on my end — give me just a moment and try again?";
        onSentence(fallback);
        return { reply: fallback, shouldTransfer };
      }
    }

    if (toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: contentBuffer || '',
        tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      });
      for (const call of toolCalls) {
        let result: any;
        let args: any = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch { /* malformed arguments - treat as empty */ }
        if (call.name === 'transfer_to_staff') {
          shouldTransfer = true;
          result = { status: ENV.staffTransferNumber ? 'transfer_ready' : 'transfer_unavailable' };
        } else {
          try {
            result = await executeToolCall(call.name, args, phone);
          } catch (err: any) {
            result = { error: String(err?.message ?? err) };
          }
        }
        messages.push({ role: 'tool', tool_call_id: call.id || call.name, content: JSON.stringify(result) });
      }
      continue;
    }

    const reply = stripLeakedFunctionSyntax(contentBuffer.trim() || 'Sorry, could you say that again?');
    if (!shouldTransfer && mentionsTransferIntent(reply) && ENV.staffTransferNumber) shouldTransfer = true;
    return { reply, shouldTransfer };
  }

  const fallback = shouldTransfer ? 'Let me connect you with our team now.' : "I'm having trouble with that right now.";
  onSentence(fallback);
  return { reply: fallback, shouldTransfer };
}
