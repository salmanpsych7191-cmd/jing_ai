import { ENV } from '../config/env';
import { normalizeDate, normalizeTime } from '../db/dates';
import {
  capacitySnapshot, createBooking, CapacityExceededError, addWaitlistEntry, getUpcomingBookings,
} from '../db/bookings';
import { getLoyalty } from '../db/loyalty';
import { reviewLinkUrl, recordCampaign } from '../db/campaigns';
import { createCorporateLead, CorporateLeadStatus } from '../db/corporateLeads';
import { sendWhatsAppMessage } from '../telephony/twilio';
import { socialLinks, lookupFaq } from '../knowledge';

export async function executeToolCall(name: string, args: any, phone: string): Promise<any> {
  if (name === 'check_availability') {
    const date = normalizeDate(args.date ?? '');
    const session = (args.session ?? 'dinner') as 'lunch' | 'dinner';
    const snap: any = (await capacitySnapshot(date))[session] ?? {};
    return {
      date, session,
      seats_remaining: snap.remaining,
      price_per_person_sgd: snap.price_per_person,
      last_seating: snap.last_seating,
    };
  }

  if (name === 'create_reservation') {
    const payload = {
      guest_name: args.guest_name,
      phone,
      date: normalizeDate(args.date),
      time: normalizeTime(args.time),
      guests: parseInt(args.guests, 10),
      special_requests: args.special_requests ?? '',
    };
    try {
      const booking = await createBooking(payload);
      return { status: 'confirmed', booking };
    } catch (err) {
      if (err instanceof CapacityExceededError) {
        const entry = await addWaitlistEntry(
          payload.guest_name, phone, payload.date, err.session, payload.guests,
          'Auto-added: buffet session was fully booked.',
        );
        return {
          status: 'waitlisted',
          reason: `Only ${err.seatsRemaining} seat(s) left for ${err.session} on ${payload.date}.`,
          waitlist_entry: entry,
        };
      }
      throw err;
    }
  }

  if (name === 'get_my_bookings') {
    return { bookings: await getUpcomingBookings(phone) };
  }

  if (name === 'get_loyalty_status') {
    return getLoyalty(phone, 'Guest');
  }

  if (name === 'join_waitlist') {
    const entry = await addWaitlistEntry(
      args.guest_name, phone, normalizeDate(args.date), args.session,
      parseInt(args.guests, 10), args.notes ?? '',
    );
    return { status: 'waitlisted', waitlist_entry: entry };
  }

  if (name === 'request_review_link') {
    return { review_link: reviewLinkUrl() || 'Link not configured yet — ask a staff member for the Google review page.' };
  }

  if (name === 'send_link') {
    return sendLinkViaWhatsApp(phone, args.link_type ?? '');
  }

  if (name === 'notify_staff') {
    return notifyStaffViaWhatsApp(phone, args.reason ?? 'Guest inquiry needs staff follow-up.');
  }

  if (name === 'log_corporate_enquiry') {
    return logCorporateEnquiry(phone, args);
  }

  if (name === 'answer_faq') {
    const answer = lookupFaq(args.topic ?? '');
    return answer
      ? { found: true, answer }
      : { found: false, note: "No matching FAQ entry - answer from general knowledge if confident, or offer to have staff follow up." };
  }

  return { error: `Unknown tool '${name}'` };
}

const LEAD_STATUS_LABEL: Record<CorporateLeadStatus, string> = {
  held: 'HELD — awaiting confirm',
  warm: 'WARM — event likely, no firm date yet',
  callback: 'CALLBACK — no event right now',
  not_keen: 'NOT KEEN — menu requested only',
};

export async function logCorporateEnquiry(phone: string, args: any) {
  const status: CorporateLeadStatus = ['held', 'warm', 'callback', 'not_keen'].includes(args.status)
    ? args.status
    : 'warm';
  const paxNum = args.pax !== undefined && args.pax !== '' ? parseInt(String(args.pax), 10) : NaN;

  const lead = await createCorporateLead({
    companyName: args.company_name || 'Unknown company',
    contactName: args.contact_name || null,
    phone,
    pax: Number.isFinite(paxNum) ? paxNum : null,
    eventDate: args.event_date || null,
    status,
    email: args.email || null,
    followUpNote: args.follow_up_note || null,
    summary: args.summary || null,
  });

  const staffLines = [
    `[${ENV.restaurantName}] New corporate enquiry (cold call)`,
    `Company: ${lead.companyName}${lead.contactName ? ` (contact: ${lead.contactName})` : ''}`,
    `Phone: ${phone}`,
    lead.pax ? `PAX: ${lead.pax}` : null,
    lead.eventDate ? `Date: ${lead.eventDate}` : null,
    `Status: ${LEAD_STATUS_LABEL[status]}`,
    lead.email ? `Email: ${lead.email} — please send the corporate menu/brochure manually.` : null,
    lead.followUpNote ? `Follow-up: ${lead.followUpNote}` : null,
    lead.summary ? `Notes: ${lead.summary}` : null,
  ].filter(Boolean) as string[];
  const staffNotified = ENV.staffTransferNumber
    ? await sendWhatsAppMessage(ENV.staffTransferNumber, staffLines.join('\n'))
    : false;

  // The script's own "WhatsApp outreach after cold call" template - sent to the
  // prospect's own number (the one we just called), reusing WhatsApp send since real
  // email sending isn't wired up yet.
  const followUpBody =
    `Hi${lead.contactName ? ` ${lead.contactName}` : ''}, this is Mel from ${ENV.restaurantName}. ` +
    `Thank you for taking the time to speak with me earlier.\n\n` +
    `One of the reasons many companies choose us is our flexible dining concept, which makes it easy to ` +
    `accommodate teams with different tastes and dietary requirements.\n\n` +
    `If you have any questions or an upcoming team lunch or company event, feel free to reach out anytime` +
    `${lead.followUpNote ? ` — I'll follow up as discussed (${lead.followUpNote}).` : '.'}\n\nHave a great day!`;
  const prospectNotified = await sendWhatsAppMessage(phone, followUpBody);

  return {
    status: 'logged',
    lead_id: lead.id,
    staff_notified: staffNotified,
    prospect_whatsapp_sent: prospectNotified,
    note: lead.email
      ? 'Enquiry logged and staff notified via WhatsApp — staff will send the brochure to the email manually.'
      : 'Enquiry logged and staff notified via WhatsApp.',
  };
}

export async function notifyStaffViaWhatsApp(customerPhone: string, reason: string) {
  if (!ENV.staffTransferNumber) {
    return { status: 'failed', note: 'STAFF_TRANSFER_NUMBER is not configured — nowhere to send the notification.' };
  }
  const body = `[${ENV.restaurantName}] Guest needs staff follow-up.\nContact: ${customerPhone}\nRequest: ${reason}`;
  const success = await sendWhatsAppMessage(ENV.staffTransferNumber, body);
  await recordCampaign('staff_notification', customerPhone, 'Guest', success ? 'sent' : 'failed', body);
  return {
    status: success ? 'sent' : 'failed',
    note: success ? "Staff notified via WhatsApp with the guest's contact." : 'Could not reach staff via WhatsApp.',
  };
}

export async function sendLinkViaWhatsApp(phone: string, linkType: string) {
  const links = socialLinks();
  const urlMap: Record<string, string> = {
    review: reviewLinkUrl() || links.googleReviewFallback,
    menu: links.website,
    instagram: links.instagram,
    facebook: links.facebook,
    website: links.website,
    opentable: links.opentable,
  };
  const url = urlMap[linkType];
  if (!url) return { error: `Unknown link_type '${linkType}'` };

  const label = linkType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const body = `Hi from ${ENV.restaurantName}! Here's the ${label} link you asked for: ${url}`;
  const success = await sendWhatsAppMessage(phone, body);
  return {
    status: success ? 'sent' : 'failed',
    link_type: linkType,
    url,
    note: success ? "Sent via WhatsApp to the guest's number." : 'Could not send WhatsApp message — Twilio may not be configured.',
  };
}

// Remove raw tool-call syntax the model occasionally leaks into spoken/text content.
// Verified in testing: Groq's fast model sometimes emits '<function=name>{...}' as
// literal text instead of a structured tool call. Left in, that would be read aloud
// or shown to the guest verbatim.
const LEAKED_FUNCTION_TAG = /<function=\w+>[\s\S]*?(?=$|<function=)/;

export function stripLeakedFunctionSyntax(text: string): string {
  const cleaned = text.replace(new RegExp(LEAKED_FUNCTION_TAG, 'g'), '').trim();
  return cleaned || text.trim();
}

// Catch the model narrating a transfer in speech without actually calling the tool.
const TRANSFER_INTENT_PHRASES = [
  'transfer', 'transferring', 'connect you', 'connecting you', 'put you through',
  'get someone', 'get a staff', 'hand you over', 'pass you to',
];

export function mentionsTransferIntent(replyText: string): boolean {
  const lowered = replyText.toLowerCase();
  return TRANSFER_INTENT_PHRASES.some((p) => lowered.includes(p));
}
