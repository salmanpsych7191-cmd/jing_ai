import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, nowIso } from './index';
import { ENV } from '../config/env';
import { sendWhatsAppMessage } from '../telephony/twilio';
import { scheduleJob } from '../scheduler';
import { nowLocal } from './dates';

export function reviewLinkUrl(): string {
  if (ENV.googlePlaceId) return `https://search.google.com/local/writereview?placeid=${ENV.googlePlaceId}`;
  return ENV.googleReviewFallbackUrl || '';
}

export async function recordCampaign(
  campaignType: string, phone: string, guestName: string, status: string, message: string,
  relatedBookingId: string | null = null,
): Promise<any> {
  const id = uuidv4();
  const sentAt = nowIso();
  await query(
    `INSERT INTO campaigns (id, type, phone, guest_name, status, message, related_booking_id, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, campaignType, phone, guestName, status, message, relatedBookingId, sentAt],
  );
  return { id, type: campaignType, phone, guest_name: guestName, status, message, sent_at: sentAt };
}

export async function listCampaigns(limit = 100) {
  return query('SELECT * FROM campaigns ORDER BY sent_at DESC LIMIT $1', [limit]);
}

export function buildReviewRequestMessage(guestName: string, platform = 'Google Maps'): string {
  const link = reviewLinkUrl();
  const linkText = link ? ` ${link}` : '';
  return (
    `Hi ${guestName}, thank you for dining at ${ENV.restaurantName}. ` +
    `We would love your feedback on ${platform}.${linkText}` +
    ' If you enjoyed your halal hotpot experience, please leave us a quick review.'
  );
}

export function buildRepurchaseReminderMessage(guestName: string, lastItem: string, nextReorder = 'This week'): string {
  return (
    `Hi ${guestName}, thanks again for your recent purchase of ${lastItem} from ${ENV.restaurantName}. ` +
    `We'd love to help you restock or reorder ${nextReorder}.`
  );
}

export async function scheduleReviewRequest(phone: string, guestName: string, bookingId: string) {
  const requestedAt = new Date(Date.now() + ENV.reviewDelayHours * 3600_000).toISOString();
  await query('UPDATE bookings SET review_requested = 1, review_requested_at = $1 WHERE id = $2', [requestedAt, bookingId]);
  const reviewText = buildReviewRequestMessage(guestName, 'Google Maps');
  const runAt = new Date(nowLocal().getTime() + ENV.reviewDelayHours * 3600_000);
  await scheduleJob(`review-request-${bookingId}`, 'send_whatsapp_message', runAt, {
    phone,
    body: reviewText,
    contentSid: ENV.twilioReviewContentSid || null,
    contentVariables: ENV.twilioReviewContentSid ? { '1': guestName, '2': ENV.restaurantName } : null,
  });
  return { phone, guest_name: guestName, requested_at: requestedAt };
}

export async function sendReviewRequest(phone: string, guestName: string, platform = 'Google Maps') {
  const body = buildReviewRequestMessage(guestName, platform);
  const success = await sendWhatsAppMessage(
    phone, body,
    ENV.twilioReviewContentSid || null,
    ENV.twilioReviewContentSid ? { '1': guestName, '2': ENV.restaurantName } : null,
  );
  const status = success ? 'sent' : 'failed';
  await recordCampaign('review_request', phone, guestName, status, body);
  return { success, phone, guest_name: guestName, platform, message: body };
}

export async function sendRepurchaseReminder(phone: string, guestName: string, lastItem: string, nextReorder = 'This week') {
  const body = buildRepurchaseReminderMessage(guestName, lastItem, nextReorder);
  const success = await sendWhatsAppMessage(
    phone, body,
    ENV.twilioReminderContentSid || null,
    ENV.twilioReminderContentSid ? { '1': guestName, '2': lastItem, '3': nextReorder } : null,
  );
  const status = success ? 'sent' : 'failed';
  await recordCampaign('retail_reminder', phone, guestName, status, body);
  return { success, phone, guest_name: guestName, message: body };
}

export async function createReviewRecord(reviewerName: string, phone: string, reviewText: string, rating: number, source = 'Dashboard') {
  const id = uuidv4();
  const createdAt = nowIso();
  await query(
    `INSERT INTO reviews (id, reviewer_name, phone, review_text, rating, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, reviewerName, phone, reviewText, rating, source, createdAt],
  );
  return { id, reviewer_name: reviewerName, phone, review_text: reviewText, rating, source, created_at: createdAt };
}

export async function listReviews(limit = 100) {
  return query('SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1', [limit]);
}

export async function saveReviewResponse(reviewId: string, draftResponse: string) {
  const respondedAt = nowIso();
  await query('UPDATE reviews SET draft_response = $1, responded_at = $2 WHERE id = $3', [draftResponse, respondedAt, reviewId]);
  return { id: reviewId, draft_response: draftResponse, responded_at: respondedAt };
}
