import { query, queryOne, nowIso } from './index';

export interface WhatsAppBookingSession {
  phone: string;
  stage: string;
  guest_name?: string | null;
  date?: string | null;
  time?: string | null;
  guests?: number | null;
  special_requests?: string | null;
}

export async function getSession(phone: string): Promise<WhatsAppBookingSession | null> {
  return queryOne<WhatsAppBookingSession>('SELECT * FROM whatsapp_sessions WHERE phone = $1', [phone]);
}

export async function saveSession(session: WhatsAppBookingSession): Promise<void> {
  await query(
    `INSERT INTO whatsapp_sessions (phone, stage, guest_name, date, time, guests, special_requests, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (phone) DO UPDATE SET
       stage = excluded.stage, guest_name = excluded.guest_name, date = excluded.date,
       time = excluded.time, guests = excluded.guests, special_requests = excluded.special_requests,
       updated_at = excluded.updated_at`,
    [session.phone, session.stage, session.guest_name ?? null, session.date ?? null, session.time ?? null,
      session.guests ?? null, session.special_requests ?? null, nowIso()],
  );
}

export async function deleteSession(phone: string): Promise<void> {
  await query('DELETE FROM whatsapp_sessions WHERE phone = $1', [phone]);
}
