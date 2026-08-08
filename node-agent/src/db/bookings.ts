import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, nowIso } from './index';
import { normalizeDate, toBookingDateTime, nowLocal, todayIsoLocal } from './dates';
import { sessionForTime, priceFor, SESSIONS, PRICING } from '../knowledge';
import { ENV } from '../config/env';
import { scheduleJob, newJobId } from '../scheduler';
import { awardPoints } from './loyalty';
import { scheduleReviewRequest } from './campaigns';

export class CapacityExceededError extends Error {
  constructor(
    public date: string,
    public session: 'lunch' | 'dinner',
    public seatsRemaining: number,
    public requested: number,
  ) {
    super(`Requested ${requested} seats for ${date} ${session}, only ${seatsRemaining} remaining`);
  }
}

export interface BookingCreateInput {
  guest_name: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
  special_requests?: string;
}

export async function seatsBookedFor(date: string, session: 'lunch' | 'dinner'): Promise<number> {
  const rows = await query<{ time: string; guests: number }>(
    "SELECT time, guests FROM bookings WHERE date = $1 AND status IN ('confirmed', 'visited')",
    [date],
  );
  return rows.filter((r) => sessionForTime(r.time) === session).reduce((sum, r) => sum + r.guests, 0);
}

export async function capacitySnapshot(date: string) {
  const snapshot: Record<string, any> = {};
  for (const [sessionKey, sessionInfo] of Object.entries(SESSIONS)) {
    const booked = await seatsBookedFor(date, sessionKey as 'lunch' | 'dinner');
    const remaining = Math.max(0, ENV.seatingCapacity - booked);
    snapshot[sessionKey] = {
      label: sessionInfo.label,
      booked,
      remaining,
      capacity: ENV.seatingCapacity,
      price_per_person: priceFor(date, sessionKey as 'lunch' | 'dinner'),
      last_seating: sessionInfo.lastSeating,
    };
  }
  return snapshot;
}

export async function addWaitlistEntry(
  guestName: string, phone: string, date: string, session: string, guests: number, notes = '',
) {
  const id = uuidv4();
  const createdAt = nowIso();
  await query(
    `INSERT INTO waitlist (id, guest_name, phone, date, session, guests, notes, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', $8)`,
    [id, guestName, phone, date, session, guests, notes, createdAt],
  );
  return { id, guest_name: guestName, phone, date, session, guests, notes, status: 'waiting', created_at: createdAt };
}

export async function listWaitlist(limit = 100) {
  return query('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT $1', [limit]);
}

export async function listTables(includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM restaurant_tables ORDER BY name ASC'
    : 'SELECT * FROM restaurant_tables WHERE active = 1 ORDER BY name ASC';
  return query(sql);
}

export async function createTable(name: string, capacity: number, section: string) {
  const id = uuidv4();
  const createdAt = nowIso();
  await query(
    'INSERT INTO restaurant_tables (id, name, capacity, section, active, created_at) VALUES ($1, $2, $3, $4, 1, $5)',
    [id, name, capacity, section, createdAt],
  );
  return { id, name, capacity, section, active: 1 };
}

export async function getTable(tableId: string) {
  const row = await queryOne('SELECT * FROM restaurant_tables WHERE id = $1', [tableId]);
  if (!row) {
    const err: any = new Error('Table not found');
    err.status = 404;
    throw err;
  }
  return row;
}

export async function updateTable(
  tableId: string,
  updates: { name?: string; capacity?: number; section?: string; active?: boolean },
) {
  const existing: any = await getTable(tableId);
  const merged = { ...existing, ...updates };
  await query(
    'UPDATE restaurant_tables SET name = $1, capacity = $2, section = $3, active = $4 WHERE id = $5',
    [merged.name, merged.capacity, merged.section, merged.active ? 1 : 0, tableId],
  );
  return getTable(tableId);
}

export async function assignTableToBooking(bookingId: string, tableId: string | null) {
  const booking = await getBooking(bookingId);
  let tableName: string | null = null;
  if (tableId) {
    const table: any = await getTable(tableId);
    tableName = table.name;
  }
  await query('UPDATE bookings SET table_id = $1, table_name = $2 WHERE id = $3', [tableId, tableName, bookingId]);
  return getBooking(bookingId);
}

// Guard against double-booking from AI re-confirmation chatter, double-taps, or client retries.
async function findRecentDuplicateBooking(payload: BookingCreateInput, windowMinutes = 15) {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  return queryOne(
    `SELECT * FROM bookings
     WHERE phone = $1 AND date = $2 AND time = $3 AND guests = $4 AND status = 'confirmed' AND created_at >= $5
     ORDER BY created_at DESC LIMIT 1`,
    [payload.phone, payload.date, payload.time, payload.guests, cutoff],
  );
}

export async function createBooking(payload: BookingCreateInput, enforceCapacity = true): Promise<any> {
  const duplicate = await findRecentDuplicateBooking(payload);
  if (duplicate) return duplicate;

  const session = sessionForTime(payload.time);
  if (enforceCapacity) {
    const booked = await seatsBookedFor(payload.date, session);
    const remaining = ENV.seatingCapacity - booked;
    if (payload.guests > remaining) {
      throw new CapacityExceededError(payload.date, session, Math.max(0, remaining), payload.guests);
    }
  }

  const bookingId = uuidv4();
  const createdAt = nowIso();
  const bookingDt = toBookingDateTime(payload.date, payload.time);
  const reminder24hAt = new Date(bookingDt.getTime() - 24 * 3600_000).toISOString();
  const reminder2hAt = new Date(bookingDt.getTime() - 2 * 3600_000).toISOString();

  await query(
    `INSERT INTO bookings (
      id, guest_name, phone, date, time, guests, special_requests, status,
      created_at, confirmed_at, reminder_24h_at, reminder_2h_at, review_requested, no_show
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0)`,
    [
      bookingId, payload.guest_name, payload.phone, payload.date, payload.time, payload.guests,
      payload.special_requests ?? '', 'confirmed', createdAt, createdAt, reminder24hAt, reminder2hAt,
    ],
  );

  const booking = await getBooking(bookingId);
  await scheduleBookingMessages(booking);
  return booking;
}

async function scheduleBookingMessages(booking: any): Promise<void> {
  const bookingDt = toBookingDateTime(booking.date, booking.time);
  const session = sessionForTime(booking.time);
  const price = priceFor(booking.date, session);
  const now = nowLocal();

  const confirmationText =
    `Booking confirmed at ${ENV.restaurantName}. ` +
    `Date: ${booking.date} Time: ${booking.time} Guests: ${booking.guests} ` +
    `(${SESSIONS[session].label} buffet, S$${price.toFixed(2)}++/pax, ${ENV.buffetDurationMinutes}-min seating). ` +
    `Halal-certified. Ask about the ${PRICING.premiumPlatter.name} if you'd like to go premium.`;

  await scheduleJob(`booking-confirmation-${booking.id}`, 'send_whatsapp_message', now, {
    phone: booking.phone,
    body: confirmationText,
    contentSid: ENV.twilioConfirmationContentSid || null,
    contentVariables: ENV.twilioConfirmationContentSid
      ? { '1': booking.guest_name, '2': ENV.restaurantName, '3': booking.date, '4': booking.time, '5': String(booking.guests) }
      : null,
  });

  if (ENV.staffTransferNumber) {
    const staffText =
      `New booking: ${booking.guest_name} (${booking.phone}) — ` +
      `${booking.date} at ${booking.time}, ${booking.guests} guest(s), ${SESSIONS[session].label} session.` +
      (booking.special_requests ? ` Notes: ${booking.special_requests}` : '');
    await scheduleJob(`booking-staff-notify-${booking.id}`, 'send_whatsapp_message', now, {
      phone: ENV.staffTransferNumber,
      body: staffText,
    });
  }

  const reminder24hText = `Reminder: your table at ${ENV.restaurantName} is tomorrow at ${booking.time}. Reply CANCEL if plans change.`;
  const reminder24hAt = new Date(bookingDt.getTime() - 24 * 3600_000);
  if (reminder24hAt > now) {
    await scheduleJob(`booking-reminder-24h-${booking.id}`, 'send_whatsapp_message', reminder24hAt, {
      phone: booking.phone,
      body: reminder24hText,
      contentSid: ENV.twilioReminderContentSid || null,
      contentVariables: ENV.twilioReminderContentSid
        ? { '1': ENV.restaurantName, '2': booking.date, '3': booking.time }
        : null,
    });
  }

  const reminder2hText = `Reminder: your table at ${ENV.restaurantName} is today at ${booking.time}. We look forward to welcoming you soon.`;
  const reminder2hAt = new Date(bookingDt.getTime() - 2 * 3600_000);
  if (reminder2hAt > now) {
    await scheduleJob(`booking-reminder-2h-${booking.id}`, 'send_whatsapp_message', reminder2hAt, {
      phone: booking.phone,
      body: reminder2hText,
      contentSid: ENV.twilioReminderContentSid || null,
      contentVariables: ENV.twilioReminderContentSid
        ? { '1': ENV.restaurantName, '2': booking.date, '3': booking.time }
        : null,
    });
  }
}

export async function getBooking(bookingId: string): Promise<any> {
  const row = await queryOne('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  if (!row) {
    const err: any = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  return row;
}

export async function listBookings(limit = 50) {
  return query('SELECT * FROM bookings ORDER BY created_at DESC LIMIT $1', [limit]);
}

export async function todaysBookings() {
  const today = todayIsoLocal();
  return query('SELECT * FROM bookings WHERE date = $1 ORDER BY time ASC', [today]);
}

export async function getUpcomingBookings(phone: string, limit = 5) {
  const today = todayIsoLocal();
  return query(
    'SELECT * FROM bookings WHERE phone = $1 AND date >= $2 ORDER BY date ASC, time ASC LIMIT $3',
    [phone, today, limit],
  );
}

export function formatBookingList(bookings: any[]): string {
  if (!bookings.length) return "You don't have any upcoming bookings on record.";
  const lines = ['Here are your upcoming bookings:'];
  for (const b of bookings) {
    lines.push(`• ${b.date} at ${b.time} for ${b.guests} guest(s) — ${b.status}`);
  }
  return lines.join('\n');
}

export async function markVisited(bookingId: string, billAmount: number): Promise<any> {
  const booking = await getBooking(bookingId);
  const visitedAt = nowIso();
  await query('UPDATE bookings SET status = $1, visited_at = $2, bill_amount = $3 WHERE id = $4', [
    'visited', visitedAt, billAmount, bookingId,
  ]);
  const loyalty = await awardPoints(booking.phone, booking.guest_name, billAmount);
  await scheduleReviewRequest(booking.phone, booking.guest_name, bookingId);
  return { ...booking, status: 'visited', visited_at: visitedAt, bill_amount: billAmount, loyalty };
}

export async function markNoShow(bookingId: string): Promise<any> {
  const booking = await getBooking(bookingId);
  await query("UPDATE bookings SET status = 'no_show', no_show = 1 WHERE id = $1", [bookingId]);
  return { ...booking, status: 'no_show', no_show: 1 };
}
