import { v4 as uuidv4 } from 'uuid';
import { query, nowIso } from './index';

export type CorporateLeadStatus = 'held' | 'warm' | 'callback' | 'not_keen';

export interface CorporateLeadInput {
  companyName: string;
  contactName?: string;
  phone: string;
  pax?: number | null;
  eventDate?: string | null;
  status: CorporateLeadStatus;
  email?: string | null;
  followUpNote?: string | null;
  summary?: string | null;
}

export async function createCorporateLead(input: CorporateLeadInput) {
  const id = uuidv4();
  const createdAt = nowIso();
  await query(
    `INSERT INTO corporate_leads
       (id, company_name, contact_name, phone, pax, event_date, status, email, follow_up_note, summary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, input.companyName, input.contactName ?? null, input.phone, input.pax ?? null,
      input.eventDate ?? null, input.status, input.email ?? null, input.followUpNote ?? null,
      input.summary ?? null, createdAt,
    ],
  );
  return { id, created_at: createdAt, ...input };
}

export async function listCorporateLeads(limit = 200) {
  return query('SELECT * FROM corporate_leads ORDER BY created_at DESC LIMIT $1', [limit]);
}
