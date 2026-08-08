import { ENV } from '../config/env';
import { whatsappClient } from './llmClient';
import { AGENT_TOOLS } from './tools';
import { executeToolCall, stripLeakedFunctionSyntax } from './toolExecutor';
import { knowledgePromptBlock, PRICING } from '../knowledge';
import { insertMessage, getRecentMessages } from '../db/messages';
import { getSession, deleteSession } from '../db/sessions';
import { startBookingSession, advanceBookingSession, sessionMessage } from './bookingSession';
import { getUpcomingBookings, formatBookingList } from '../db/bookings';
import { getLoyalty } from '../db/loyalty';
import { reviewLinkUrl } from '../db/campaigns';

export function detectIntent(text: string): string {
  const lowered = text.toLowerCase();
  const has = (words: string[]) => words.some((w) => lowered.includes(w));
  if (has(['hi', 'hello', 'hey', 'start'])) return 'greeting';
  if (has(['help', 'support', 'assist', 'what can you do'])) return 'help';
  if (has(['book', 'reserve', 'table', 'reservation'])) return 'book';
  if (has(['my booking', 'upcoming', 'my reservation', 'my bookings'])) return 'bookings';
  if (has(['point', 'loyalty', 'reward', 'voucher', 'member'])) return 'loyalty';
  if (has(['review', 'feedback', 'rate', 'google review'])) return 'review';
  if (has(['cancel', 'stop', 'abort'])) return 'cancel';
  return 'unknown';
}

export async function ruleEngineReply(phone: string, text: string, intent: string): Promise<string> {
  if (intent === 'greeting') {
    return (
      `Hi there! Welcome to ${ENV.restaurantName}. ` +
      'I can help you book a table, check your upcoming bookings, view loyalty points, or request a review link. What would you like to do?'
    );
  }
  if (intent === 'help') {
    return (
      "Here's what I can help with:\n" +
      "• Book a table — just say 'Book a table'\n" +
      "• Check your upcoming bookings — say 'My bookings'\n" +
      "• View loyalty points and vouchers — say 'Loyalty points'\n" +
      "• Request a review link — say 'Leave a review'\n" +
      'Reply with CANCEL at any time to stop a booking.'
    );
  }
  if (intent === 'book') {
    await startBookingSession(phone);
    return sessionMessage('name');
  }
  if (intent === 'bookings') {
    const bookings = await getUpcomingBookings(phone);
    return formatBookingList(bookings);
  }
  if (intent === 'loyalty') {
    const loyalty: any = await getLoyalty(phone, 'Guest');
    const vouchers = loyalty.last_voucher_code ? ` Voucher code: ${loyalty.last_voucher_code}` : '';
    return (
      `Hi ${loyalty.guest_name}, you have ${loyalty.total_points} loyalty points ` +
      `across ${loyalty.visit_count} visit(s).${vouchers} ` +
      `Reach ${ENV.loyaltyThreshold} points to unlock a ${ENV.loyaltyRewardPct}% reward.`
    );
  }
  if (intent === 'review') {
    const link = reviewLinkUrl();
    const linkText = link ? ` Click here: ${link}` : '';
    return (
      `Thank you for dining at ${ENV.restaurantName}! We'd love your feedback.${linkText} ` +
      'Reply BOOK if you\'d also like to make a new reservation.'
    );
  }
  return (
    `Thanks for contacting ${ENV.restaurantName}. ` +
    'I can help with bookings, loyalty points, reviews, and more. Say HELP for options or BOOK to reserve a table.'
  );
}

export async function runAiConcierge(phone: string, text: string, history: any[]): Promise<string> {
  const today = new Date();
  const systemPrompt = `
You are the AI concierge for ${ENV.restaurantName}, a halal Chinese hotpot & grill buffet in Singapore.
Today is ${today.toDateString()}. The guest's WhatsApp phone number is already known (${phone}) — never ask for it.

${knowledgePromptBlock()}

Guidelines:
- Be warm, concise (2-4 short sentences or a tight bullet list), and proud of the halal, Muslim-owned identity.
- Never invent menu items, prices, or hours — only use the facts above. Use the tools for anything involving real bookings, availability, loyalty points, or the review link.
- Before calling create_reservation, make sure you have guest name, date, time, and party size, and the guest has clearly said to go ahead / confirm.
- If you already confirmed this exact booking earlier in the conversation, do NOT call create_reservation again — a guest saying "yes"/"confirm" afterward is just acknowledging, not requesting a second booking.
- If a soup base or dietary preference is mentioned, store it in special_requests.
- When a booking is confirmed, mention the session's per-person price and the ${ENV.buffetDurationMinutes}-minute seating window.
- If a slot is full, the tool will waitlist the guest automatically — reassure them and offer an alternate date/time.
- You may suggest the ${PRICING.premiumPlatter.name} (S$${PRICING.premiumPlatter.price.toFixed(2)}) as a nice upsell when it fits naturally, but don't force it.
- This is a WhatsApp text conversation — just type links directly in your reply. Don't use the send_link tool here, it would send a separate redundant message; the guest is already reading your text.
- For group bookings, private events, or large parties: use the notify_staff tool so a human follows up, and tell the guest staff will be in touch shortly. Don't try to arrange these yourself.
`.trim();

  const messages: any[] = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }];

  for (let i = 0; i < 4; i++) {
    const completion = await whatsappClient!.chat.completions.create({
      model: ENV.groqModel,
      messages,
      tools: AGENT_TOOLS as any,
      tool_choice: 'auto',
      temperature: 0.4,
      max_tokens: 400,
    });
    const message = completion.choices[0].message;
    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return stripLeakedFunctionSyntax((message.content ?? '').trim() || 'Sorry, could you rephrase that?');
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      tool_calls: toolCalls.map((c) => ({
        id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments },
      })),
    });
    for (const call of toolCalls) {
      let result: any;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        result = await executeToolCall(call.function.name, args, phone);
      } catch (err: any) {
        result = { error: String(err?.message ?? err) };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return "I'm having trouble completing that right now — could you try again, or say HELP for options?";
}

export async function processWhatsAppText(phone: string, text: string): Promise<string> {
  const historyBefore = await getRecentMessages(phone, 10);
  const history = [...historyBefore].reverse()
    .filter((m: any) => !String(m.message).startsWith('[send-failed]'))
    .map((m: any) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.message }));

  await insertMessage(phone, 'in', text);
  const session = await getSession(phone);
  const intent = detectIntent(text);

  let responseText: string;
  if (intent === 'cancel' && session) {
    await deleteSession(phone);
    responseText = 'Your booking request has been cancelled. Send a new message anytime to start again.';
  } else if (session) {
    [responseText] = await advanceBookingSession(session, text);
  } else if (whatsappClient) {
    try {
      responseText = await runAiConcierge(phone, text, history);
    } catch (err) {
      console.warn(`AI concierge failed for ${phone}, falling back to rule engine:`, err);
      responseText = await ruleEngineReply(phone, text, intent);
    }
  } else {
    responseText = await ruleEngineReply(phone, text, intent);
  }

  await insertMessage(phone, 'out', responseText);
  return responseText;
}
