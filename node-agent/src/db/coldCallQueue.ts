import { v4 as uuidv4 } from 'uuid';
import { query, nowIso } from './index';
import { ENV } from '../config/env';

export type ColdCallQueueStatus = 'pending' | 'calling' | 'called' | 'failed';

export interface ParsedColdCallRow { companyName: string; contactName: string | null; phone: string }
export interface ParseResult { rows: ParsedColdCallRow[]; skipped: number; total: number }

// Best-effort E.164 normalization, defaulting bare local numbers to Singapore (+65)
// since cold-call leads are companies around KINEX - most uploaded sheets won't
// include a country code at all.
export function normalizeColdCallPhone(raw: string): string | null {
  let v = (raw ?? '').trim().replace(/[\s\-().]/g, '');
  if (!v) return null;
  if (v.startsWith('+')) return /^\+\d{7,15}$/.test(v) ? v : null;
  v = v.replace(/^0+/, '');
  if (/^65\d{8}$/.test(v)) return `+${v}`;
  if (/^\d{8}$/.test(v)) return `+65${v}`;
  if (/^\d{7,15}$/.test(v)) return `+${v}`;
  return null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// Accepts a header row with recognizable column names (company_name/company,
// contact_name/contact, phone/number) in any order; falls back to a fixed
// company,contact,phone column order if no recognizable header is found.
export function parseColdCallCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], skipped: 0, total: 0 };

  const firstCells = parseCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
  const companyIdx = firstCells.findIndex((h) => ['company_name', 'company', 'company name'].includes(h));
  const contactIdx = firstCells.findIndex((h) => ['contact_name', 'contact', 'contact name'].includes(h));
  const phoneIdx = firstCells.findIndex((h) => ['phone', 'phone_number', 'phone number', 'number'].includes(h));
  const hasHeader = companyIdx !== -1 && phoneIdx !== -1;

  const colCompany = hasHeader ? companyIdx : 0;
  const colContact = hasHeader ? contactIdx : 1;
  const colPhone = hasHeader ? phoneIdx : 2;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows: ParsedColdCallRow[] = [];
  let skipped = 0;
  for (const line of dataLines) {
    const cells = parseCsvLine(line);
    const companyName = cells[colCompany]?.trim();
    const contactName = (colContact >= 0 ? cells[colContact] : '')?.trim() || null;
    const phone = normalizeColdCallPhone(cells[colPhone] ?? '');
    if (!companyName || !phone) { skipped++; continue; }
    rows.push({ companyName, contactName, phone });
  }
  return { rows, skipped, total: dataLines.length };
}

export async function enqueueColdCallRows(rows: ParsedColdCallRow[]): Promise<{ batchId: string; inserted: number }> {
  const batchId = uuidv4();
  const uploadedAt = nowIso();
  for (const row of rows) {
    await query(
      `INSERT INTO cold_call_queue (id, batch_id, company_name, contact_name, phone, status, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [uuidv4(), batchId, row.companyName, row.contactName, row.phone, uploadedAt],
    );
  }
  return { batchId, inserted: rows.length };
}

export async function getNextPendingColdCall() {
  return query(
    `SELECT * FROM cold_call_queue WHERE status = 'pending' ORDER BY uploaded_at ASC LIMIT 1`,
  ).then((rows) => rows[0] ?? null);
}

export async function markColdCallStatus(id: string, status: ColdCallQueueStatus, callSid?: string | null) {
  await query(
    `UPDATE cold_call_queue SET status = $1, call_sid = COALESCE($2, call_sid), called_at = $3 WHERE id = $4`,
    [status, callSid ?? null, status === 'calling' || status === 'called' || status === 'failed' ? nowIso() : null, id],
  );
}

// "Today" is measured in the restaurant's local timezone, not UTC, since the daily
// cap is a business-hours concept (e.g. "100 calls between 10am-6pm SGT").
export async function countColdCallsToday(): Promise<number> {
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: ENV.bookingTimezone }).format(new Date());
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM cold_call_queue WHERE status IN ('calling', 'called') AND called_at IS NOT NULL AND called_at LIKE $1`,
    [`${todayLocal}%`],
  );
  return parseInt(rows[0]?.n ?? '0', 10);
}

export async function coldCallQueueStatus() {
  const rows = await query<{ status: string; n: string }>(
    `SELECT status, COUNT(*) AS n FROM cold_call_queue GROUP BY status`,
  );
  const counts: Record<string, number> = { pending: 0, calling: 0, called: 0, failed: 0 };
  for (const r of rows) counts[r.status] = parseInt(r.n, 10);
  return {
    pending: counts.pending,
    calling: counts.calling,
    called: counts.called,
    failed: counts.failed,
    called_today: await countColdCallsToday(),
    daily_cap: ENV.coldCallDailyCap,
  };
}

export async function listColdCallQueue(limit = 200) {
  return query('SELECT * FROM cold_call_queue ORDER BY uploaded_at DESC LIMIT $1', [limit]);
}
