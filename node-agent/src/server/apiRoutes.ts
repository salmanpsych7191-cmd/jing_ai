import { Express, Request, Response } from 'express';
import { ENV } from '../config/env';
import { pool, query } from '../db';
import { normalizeDate } from '../db/dates';
import {
  listBookings, todaysBookings, createBooking, markVisited, markNoShow, capacitySnapshot,
  addWaitlistEntry, listWaitlist, listTables, createTable, updateTable, assignTableToBooking,
  CapacityExceededError,
} from '../db/bookings';
import { listLoyalty, getLoyalty } from '../db/loyalty';
import {
  listCampaigns, sendReviewRequest, sendRepurchaseReminder, createReviewRecord, listReviews,
} from '../db/campaigns';
import { menuSummary, RESTAURANT_PROFILE } from '../knowledge';
import { twilioDiagnostics, sendWhatsAppMessage, twilioClient } from '../telephony/twilio';
import { processWhatsAppText } from '../whatsapp/concierge';
import { deleteSession } from '../db/sessions';
import { whatsappClient } from '../whatsapp/llmClient';
import { verifyTwilioMiddleware } from './verifyTwilio';
import { parseColdCallCsv, enqueueColdCallRows, coldCallQueueStatus, listColdCallQueue } from '../db/coldCallQueue';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(err);
      const status = err?.status ?? 500;
      res.status(status).json({ detail: err?.message ?? 'Internal error' });
    });
  };
}

export function registerApiRoutes(app: Express): void {
  app.get('/api/summary', asyncHandler(async (_req, res) => {
    const bookings: any[] = await listBookings(200);
    const today = await todaysBookings();
    const loyaltyRows = await query('SELECT * FROM loyalty ORDER BY updated_at DESC LIMIT 200');
    const messageCountRow: any = (await query('SELECT COUNT(DISTINCT phone) AS conversations FROM message_log'))[0];
    const campaignsCountRow: any = (await query("SELECT COUNT(*) AS campaigns FROM bookings WHERE review_requested = 1"))[0];

    const totalPoints = loyaltyRows.reduce((sum: number, r: any) => sum + Number(r.total_points), 0);
    const totalRevenue = bookings.filter((b) => b.status === 'visited').reduce((sum, b) => sum + Number(b.bill_amount || 0), 0);
    const avgPartySize = bookings.length
      ? Math.round((bookings.reduce((sum, b) => sum + b.guests, 0) / bookings.length) * 10) / 10
      : 0;
    const todayIso = new Date().toISOString().slice(0, 10);
    const capacityToday = await capacitySnapshot(todayIso);
    const waitlist: any[] = await listWaitlist(200);
    const waitlistOpen = waitlist.filter((w) => w.status === 'waiting').length;

    res.json({
      restaurant: ENV.restaurantName,
      tagline: RESTAURANT_PROFILE.tagline,
      bookings_total: bookings.length,
      bookings_today: today.length,
      loyalty_customers: loyaltyRows.length,
      loyalty_points_total: totalPoints,
      conversations: Number(messageCountRow?.conversations ?? 0),
      active_campaigns: Number(campaignsCountRow?.campaigns ?? 0),
      total_revenue: Math.round(totalRevenue * 100) / 100,
      avg_party_size: avgPartySize,
      review_delay_hours: ENV.reviewDelayHours,
      threshold: ENV.loyaltyThreshold,
      reward_pct: ENV.loyaltyRewardPct,
      whatsapp_number_configured: Boolean(ENV.twilioWhatsappNumber),
      twilio_sender: ENV.twilioWhatsappNumber,
      google_place_id_configured: Boolean(ENV.googlePlaceId || ENV.googleReviewFallbackUrl),
      google_rating: ENV.googleRating || null,
      restaurant_phone_configured: Boolean(ENV.restaurantPhone),
      seating_capacity: ENV.seatingCapacity,
      buffet_duration_minutes: ENV.buffetDurationMinutes,
      capacity_today: capacityToday,
      waitlist_open: waitlistOpen,
      halal_certified: true,
      ai_concierge_enabled: Boolean(whatsappClient),
    });
  }));

  app.get('/api/menu', (_req, res) => res.json(menuSummary()));

  app.get('/api/capacity', asyncHandler(async (req, res) => {
    const dateParam = req.query.date as string | undefined;
    const targetDate = dateParam ? normalizeDate(dateParam) : new Date().toISOString().slice(0, 10);
    res.json({ date: targetDate, sessions: await capacitySnapshot(targetDate) });
  }));

  app.get('/api/bookings', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    res.json(await listBookings(limit));
  }));

  app.get('/api/todays-bookings', asyncHandler(async (_req, res) => { res.json(await todaysBookings()); }));

  app.post('/api/bookings', asyncHandler(async (req, res) => {
    const { guest_name, phone, date, time, guests, special_requests } = req.body;
    try {
      const booking = await createBooking({ guest_name, phone, date, time, guests, special_requests });
      res.json(booking);
    } catch (err) {
      if (err instanceof CapacityExceededError) {
        res.status(400).json({ detail: err.message });
        return;
      }
      throw err;
    }
  }));

  app.post('/api/bookings/:id/visited', asyncHandler(async (req, res) => {
    const billAmount = Number(req.body.bill_amount ?? 0);
    res.json(await markVisited(req.params.id, billAmount));
  }));

  app.post('/api/bookings/:id/no-show', asyncHandler(async (req, res) => { res.json(await markNoShow(req.params.id)); }));

  app.post('/api/bookings/:id/assign-table', asyncHandler(async (req, res) => {
    res.json(await assignTableToBooking(req.params.id, req.body.table_id ?? null));
  }));

  app.get('/api/loyalty', asyncHandler(async (req, res) => {
    const phone = req.query.phone as string | undefined;
    if (phone) {
      res.json(await getLoyalty(phone, (req.query.guest_name as string) ?? 'Guest'));
      return;
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    res.json(await listLoyalty(limit));
  }));

  app.get('/api/waitlist', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json(await listWaitlist(limit));
  }));

  app.post('/api/waitlist', asyncHandler(async (req, res) => {
    const { guest_name, phone, date, session, guests, notes } = req.body;
    res.json(await addWaitlistEntry(guest_name, phone, normalizeDate(date), session, guests, notes ?? ''));
  }));

  app.get('/api/tables', asyncHandler(async (req, res) => {
    res.json(await listTables(req.query.include_inactive === 'true'));
  }));

  app.post('/api/tables', asyncHandler(async (req, res) => {
    const { name, capacity, section } = req.body;
    res.json(await createTable(name, capacity, section ?? ''));
  }));

  app.put('/api/tables/:id', asyncHandler(async (req, res) => {
    res.json(await updateTable(req.params.id, req.body));
  }));

  app.get('/api/campaigns', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json(await listCampaigns(limit));
  }));

  app.post('/api/reviews/request', asyncHandler(async (req, res) => {
    const { phone, guest_name, platform } = req.body;
    res.json(await sendReviewRequest(phone, guest_name, platform ?? 'Google Maps'));
  }));

  app.post('/api/retail/reminder', asyncHandler(async (req, res) => {
    const { phone, guest_name, last_item, next_reorder } = req.body;
    res.json(await sendRepurchaseReminder(phone, guest_name, last_item, next_reorder ?? 'This week'));
  }));

  app.get('/api/reviews', asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json(await listReviews(limit));
  }));

  app.post('/api/reviews', asyncHandler(async (req, res) => {
    const { reviewer_name, phone, review_text, rating, source } = req.body;
    res.json(await createReviewRecord(reviewer_name, phone ?? '', review_text, rating, source ?? 'Dashboard'));
  }));

  app.post('/api/reviews/draft', asyncHandler(async (req, res) => {
    if (!whatsappClient) {
      res.status(400).json({ detail: 'GROQ_API_KEY is required to draft review responses' });
      return;
    }
    const { reviewer_name, review_text, rating } = req.body;
    const tone = rating >= 4 ? 'warm and grateful' : 'empathetic and solution-focused';
    const prompt = `
Write a Google review response for ${ENV.restaurantName}.
Reviewer: ${reviewer_name}
Rating: ${rating}/5
Review: ${review_text}
Tone: ${tone}
Keep it 3-4 short sentences.
Return only the response text.
`.trim();
    const completion = await whatsappClient.chat.completions.create({
      model: ENV.groqModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 200,
    });
    res.json({ draft_response: (completion.choices[0].message.content ?? '').trim() });
  }));

  app.get('/api/diagnostics/twilio', (_req, res) => res.json(twilioDiagnostics()));

  app.post('/api/diagnostics/twilio/test', asyncHandler(async (req, res) => {
    const phone = req.body.phone as string;
    const success = await sendWhatsAppMessage(phone, 'Test message from JING AI Agent (Node).');
    res.json({ success });
  }));

  app.post('/api/chat/message', asyncHandler(async (req, res) => {
    const { phone, message } = req.body;
    if (!message || !String(message).trim()) {
      res.status(400).json({ detail: 'Message is required' });
      return;
    }
    const reply = await processWhatsAppText(phone, String(message).trim());
    res.json({ phone, message, reply, active_session: false, session_stage: null });
  }));

  app.post('/api/chat/reset', asyncHandler(async (req, res) => {
    await deleteSession(req.body.phone);
    res.json({ phone: req.body.phone, reset: true });
  }));

  app.post('/api/test/voice-note', asyncHandler(async (req, res) => {
    const transcript = String(req.body.transcript ?? '').trim();
    if (!transcript) {
      res.status(400).json({ detail: 'Transcript is required' });
      return;
    }
    const reply = await processWhatsAppText(req.body.phone, transcript);
    res.json({ phone: req.body.phone, transcript, reply });
  }));

  app.post('/api/voice/cold-call-queue/upload', asyncHandler(async (req, res) => {
    const csv = String(req.body.csv ?? '');
    if (!csv.trim()) {
      res.status(400).json({ detail: 'No CSV content received.' });
      return;
    }
    const { rows, skipped, total } = parseColdCallCsv(csv);
    if (rows.length === 0) {
      res.status(400).json({ detail: 'No valid rows found. Expect columns company_name, contact_name (optional), phone.' });
      return;
    }
    const { batchId, inserted } = await enqueueColdCallRows(rows);
    res.json({ batch_id: batchId, inserted, skipped, total });
  }));

  app.get('/api/voice/cold-call-queue/status', asyncHandler(async (_req, res) => {
    res.json(await coldCallQueueStatus());
  }));

  app.get('/api/voice/cold-call-queue', asyncHandler(async (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '200'), 10);
    res.json(await listColdCallQueue(limit));
  }));

  // Inbound WhatsApp messages from Twilio
  app.post('/webhook/whatsapp', verifyTwilioMiddleware, asyncHandler(async (req, res) => {
    const phone = String(req.body.From ?? '').replace('whatsapp:', '');
    const text = String(req.body.Body ?? '').trim();
    const reply = await processWhatsAppText(phone, text || '(empty message)');
    const twilio = await import('twilio');
    const MessagingResponse = twilio.default.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
  }));

}
