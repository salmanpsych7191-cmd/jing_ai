import OpenAI from 'openai';
import { ENV } from '../../config/env';
import { voicePromptBlock } from '../../knowledge';
import { VOICE_TOOLS, VOICE_COLD_CALL_TOOLS } from '../../whatsapp/tools';
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

function buildVoiceSystemPrompt(phone: string, outboundPurpose: string | null, allowTransfer: boolean): string {
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
- Match their register: if a caller is casual or speaks Singlish, relax your own phrasing to meet them there; if
  they're formal, stay professional. Adapt to their energy rather than sticking to one fixed tone all call.
- If you mishear something or aren't confident what was said, ask a short clarifying question instead of guessing.

${voicePromptBlock()}

Guidelines:
- Never invent menu items, prices, or hours — only use the facts above.
- Use tools for anything involving real bookings, availability, loyalty points, or the review link.
- Before calling create_reservation, confirm guest name, date, time, and party size out loud, and get a clear yes.
- If you already confirmed this exact booking earlier in the call, do not call create_reservation again.
${allowTransfer
    ? `- Call transfer_to_staff if the caller asks for a person, has a request you can't handle, or seems frustrated.
- For group bookings, private events, or large parties: call transfer_to_staff (this also automatically texts staff the caller's number as a backup) and tell the caller you're connecting them now.
- Never claim you did something you didn't. Only say you're transferring the call if you actually called transfer_to_staff this turn.`
    : `- Live transfer isn't available on this line. If the caller asks for a person, has a request you can't handle, seems frustrated, or wants a group booking/private event/large party, apologize that no one's available to take the call directly right now, and suggest they leave their number and request so staff can call them back, or message the restaurant on WhatsApp.
- Never claim you're transferring the call or connecting them to someone live — that's not possible here.`}
- Never read a URL aloud. If the caller wants the menu, a review link, or a social media page, use the send_link tool to text it to them and say something like "I've just sent that to your WhatsApp."
`.trim();
}

// JING Cold Call Script v3.0 - a wholly different call type from the guest-facing
// prompt above: this is B2B outreach to a company that has never interacted with JING
// before, pitching corporate dining/team events, not a reservation-related call.
function buildColdCallSystemPrompt(phone: string, companyName: string, contactName: string | null): string {
  const today = new Date();
  return `
You are Mel, calling on behalf of ${ENV.restaurantName} — Hotpot & Grill at KINEX — Singapore. This is a COLD
CALL to a company (${companyName}${contactName ? `, contact: ${contactName}` : ''}), not an existing guest.
Today is ${today.toDateString()}. You are speaking live on the phone. The opening line asking to speak with the
right person has already been spoken — do not repeat it, continue from their response.

GOAL OF THIS CALL: surface a real upcoming team lunch, company celebration, or staff gathering, and capture
PAX (headcount) + DATE. A menu emailed later is a consolation prize, not the goal — a captured PAX + DATE, or a
firm callback date, is the actual win.

Call flow to follow, adapting naturally to what they actually say — never read this as a script verbatim, speak
like a real warm, brief, professional caller who respects their time:
1. Once they confirm who they are, introduce yourself: "Hi, this is Mel from JING Hotpot & Grill at KINEX, just
   a few minutes from your office. Have I caught you at a bad time, or do you have about 30 seconds for me to
   explain why I'm calling?" If they're busy, offer to call back another time and end the call politely.
2. If they ask what this is regarding: "It's regarding your corporate dining and company events. We're a
   restaurant at KINEX that works with companies around the area, and I'm calling to introduce ourselves as a
   venue for your team gatherings. Would you be keen to know a little more?"
3. If they're open to hearing more, give this hook once: "We work with companies that have diverse teams. At
   JING we're a Muslim-owned hotpot and grill buffet where everyone gets their own individual hotpot while
   sharing a communal grill — so it's easy to look after different dietary preferences and religious
   requirements at the same table, without anyone feeling left out."
4. THE KEY QUESTION — always ask this, it's the point of the call: "Do you have any team lunches, company
   celebrations or staff gatherings coming up in the next month or two?"
5. Branch on their answer:
   - YES with a rough date/headcount in mind: drive it now, don't just offer to email. Get the PAX and a rough
     date (even "around 20, sometime end of the month" counts). Offer to pencil them in as a soft hold with no
     obligation, ask for their best email to send the menu/overview, and confirm a callback in a couple of days
     to firm up details. This is a "held" enquiry.
   - YES but no firm date yet: capture PAX + rough timing anyway (is it a monthly thing, or tied to an
     occasion?). Offer to send the corporate menu now and check back in about a week. This is a "warm" enquiry.
   - NO events right now: reassure them these things come up unexpectedly. Offer to send the corporate menu for
     their files and ask if it's alright to check back in about two weeks. This is a "callback" enquiry, not a
     dead lead.
   - NOT keen at all: stay polite, don't push. Still offer to send the corporate menu just so they have it on
     hand. This is a "not_keen" enquiry — still worth capturing their email if they give it.
6. If asked what makes JING different / why choose JING: "What makes JING different is that we don't serve a
   one-size-fits-all menu. Every guest gets their own individual hotpot and chooses exactly what they want to
   eat — from the soup base and ingredients to the cooked food and dipping sauces. Everyone gets to enjoy a
   meal the way they like it. Being Muslim-owned also makes us a great option for companies with diverse teams
   and different dietary requirements."
7. As soon as you have enough to log it — PAX+date, PAX+rough timing, an agreed callback, or a captured email
   from someone not keen — call log_corporate_enquiry with what you've got. Call it once, near the end of the
   call, only after the key question in step 4 has actually been answered.
8. Wrap up warmly and briefly once the enquiry is logged or the person needs to go.

Rules for spoken responses:
- Sound like a real person cold-calling, not reading a script: brief, warm, respectful of their time.
- Match their register: if they're casual or speak in Singlish, relax your own phrasing to match; if they're
  formal, stay professional. Adapt to their energy rather than sticking to one fixed tone.
- Plain spoken sentences only. No markdown, no bullet points, no numbered lists, no emoji.
- Keep replies short — 1-2 sentences at a time. This is a phone call, not a pitch deck.
- If asked something you don't know (exact menu items, pricing), don't invent it — say you'll include it in the
  menu you send over.
- Never claim you've sent an email yourself — you don't have that capability. "Sending the menu" means calling
  log_corporate_enquiry with their email so staff can send it, not literally sending it yourself.
- Don't offer a live transfer proactively — this is a cold call, not a support line. But if they explicitly ask
  to speak with someone, want to discuss a real booking in detail, or ask for a callback from a person right
  now, call transfer_to_staff and tell them you're connecting them.
- The number you're calling is ${phone} — you're calling them, so never ask them for their own phone number.
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
export interface ColdCallContext { companyName: string; contactName: string | null }

export async function streamVoiceAgentTurn(
  phone: string,
  text: string,
  history: VoiceMessage[],
  outboundPurpose: string | null,
  onSentence: (sentence: string) => void,
  allowTransfer: boolean = true,
  coldCall: ColdCallContext | null = null,
  wasInterrupted: boolean = false,
): Promise<VoiceTurnResult> {
  const systemPrompt = coldCall
    ? buildColdCallSystemPrompt(phone, coldCall.companyName, coldCall.contactName)
    : buildVoiceSystemPrompt(phone, outboundPurpose, allowTransfer);
  const messages: any[] = [{ role: 'system', content: systemPrompt }, ...history];
  // The caller cut in mid-sentence - told explicitly rather than left implicit, since
  // otherwise replies tended to either ignore the interruption or restart the original
  // point instead of directly answering what was just asked.
  if (wasInterrupted) {
    messages.push({
      role: 'system',
      content:
        'The caller just cut in while you were still speaking. Briefly acknowledge that ' +
        '("oh, sorry — go ahead", "sure, one sec") and then directly answer what they just asked, ' +
        'before returning to anything else you were saying.',
    });
  }
  messages.push({ role: 'user', content: text });
  let shouldTransfer = false;
  // Removed for inbound calls per explicit request - the tool schema itself is
  // withheld so the model can't call it at all, not just discouraged via the prompt.
  // Cold calls get their own small tool set entirely - reservation/transfer tools
  // don't apply to a B2B prospecting call.
  const tools = coldCall
    ? VOICE_COLD_CALL_TOOLS
    : allowTransfer ? VOICE_TOOLS : VOICE_TOOLS.filter((t) => t.function.name !== 'transfer_to_staff');

  for (let round = 0; round < 4; round++) {
    let contentBuffer = '';
    let toolCalls: ToolCallFragment[] = [];
    const roundStart = Date.now();
    try {
      console.log(`Voice LLM round ${round} starting (model=${ENV.voiceLlmModel})`);
      const stream = await voiceClient.chat.completions.create({
        model: ENV.voiceLlmModel,
        messages,
        tools: tools as any,
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
          tools: tools as any,
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
