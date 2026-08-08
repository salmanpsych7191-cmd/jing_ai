import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, nowIso } from './index';
import { ENV } from '../config/env';
import { sendWhatsAppMessage } from '../telephony/twilio';

export async function getLoyalty(phone: string, guestName: string): Promise<any> {
  const row = await queryOne('SELECT * FROM loyalty WHERE phone = $1', [phone]);
  if (row) return row;
  return {
    phone, guest_name: guestName, total_points: 0, visit_count: 0,
    last_visit: null, vouchers_issued: 0, last_voucher_code: null,
  };
}

export async function saveLoyalty(record: any): Promise<any> {
  await query(
    `INSERT INTO loyalty (phone, guest_name, total_points, visit_count, last_visit, vouchers_issued, last_voucher_code, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (phone) DO UPDATE SET
       guest_name = excluded.guest_name, total_points = excluded.total_points,
       visit_count = excluded.visit_count, last_visit = excluded.last_visit,
       vouchers_issued = excluded.vouchers_issued, last_voucher_code = excluded.last_voucher_code,
       updated_at = excluded.updated_at`,
    [record.phone, record.guest_name, record.total_points, record.visit_count, record.last_visit,
      record.vouchers_issued, record.last_voucher_code, nowIso()],
  );
  return record;
}

function generateVoucherCode(): string {
  return `LOYAL-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export async function awardPoints(phone: string, guestName: string, billAmount: number) {
  const record: any = await getLoyalty(phone, guestName);
  const earned = Math.round(billAmount);
  const oldPoints = Number(record.total_points || 0);
  const newPoints = oldPoints + earned;

  record.phone = phone;
  record.guest_name = guestName;
  record.total_points = newPoints;
  record.visit_count = Number(record.visit_count || 0) + 1;
  record.last_visit = new Date().toISOString().slice(0, 10);

  const rewardUnlocked = newPoints >= ENV.loyaltyThreshold && oldPoints < ENV.loyaltyThreshold;
  if (rewardUnlocked) {
    record.vouchers_issued = Number(record.vouchers_issued || 0) + 1;
    record.last_voucher_code = generateVoucherCode();
    record.total_points = 0;
    const loyaltyBody =
      `Congratulations ${guestName}! You unlocked a ${ENV.loyaltyRewardPct}% reward voucher. ` +
      `Your voucher code is ${record.last_voucher_code}.`;
    await sendWhatsAppMessage(
      phone, loyaltyBody,
      ENV.twilioLoyaltyContentSid || null,
      ENV.twilioLoyaltyContentSid
        ? { '1': guestName, '2': String(ENV.loyaltyRewardPct), '3': record.last_voucher_code }
        : null,
    );
  }

  await saveLoyalty(record);
  return {
    earned,
    total_points: record.total_points,
    reward_unlocked: rewardUnlocked,
    voucher_code: record.last_voucher_code,
    threshold: ENV.loyaltyThreshold,
    reward_pct: ENV.loyaltyRewardPct,
  };
}

export async function listLoyalty(limit = 200) {
  return query('SELECT * FROM loyalty ORDER BY updated_at DESC LIMIT $1', [limit]);
}
