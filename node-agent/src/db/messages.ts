import { v4 as uuidv4 } from 'uuid';
import { query, nowIso } from './index';

export async function insertMessage(phone: string, direction: 'in' | 'out', message: string): Promise<void> {
  await query(
    'INSERT INTO message_log (id, phone, direction, message, created_at) VALUES ($1, $2, $3, $4, $5)',
    [uuidv4(), phone, direction, message, nowIso()],
  );
}

export async function getRecentMessages(phone: string, limit = 10): Promise<any[]> {
  return query(
    'SELECT * FROM message_log WHERE phone = $1 ORDER BY created_at DESC LIMIT $2',
    [phone, limit],
  );
}
