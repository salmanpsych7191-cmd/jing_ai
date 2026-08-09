import cron from 'node-cron';
import { ENV } from '../config/env';
import { getNextPendingColdCall, markColdCallStatus, countColdCallsToday } from '../db/coldCallQueue';
import { placeColdCall } from '../telephony/twilio';

function withinCallingWindow(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ENV.bookingTimezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  if (ENV.coldCallWeekdaysOnly && !isWeekday) return false;
  return hour >= ENV.coldCallWindowStartHour && hour < ENV.coldCallWindowEndHour;
}

async function dialNext(): Promise<void> {
  if (!withinCallingWindow()) return;
  const calledToday = await countColdCallsToday();
  if (calledToday >= ENV.coldCallDailyCap) return;

  const next = await getNextPendingColdCall();
  if (!next) return;

  await markColdCallStatus(next.id, 'calling');
  try {
    const callSid = await placeColdCall(next.phone, next.company_name, next.contact_name);
    await markColdCallStatus(next.id, 'called', callSid);
    console.log(`[ColdCallDialer] Dialed ${next.company_name} (${next.phone}), call ${callSid}`);
  } catch (err) {
    await markColdCallStatus(next.id, 'failed');
    console.error(`[ColdCallDialer] Failed to dial ${next.company_name} (${next.phone}):`, err);
  }
}

export function startColdCallDialer(): void {
  const interval = Math.max(1, ENV.coldCallIntervalMinutes);
  cron.schedule(`*/${interval} * * * *`, () => {
    dialNext().catch((err) => console.error('[ColdCallDialer] Tick failed:', err));
  });
  console.log(
    `[ColdCallDialer] Started - every ${interval}min, ${ENV.coldCallWindowStartHour}:00-${ENV.coldCallWindowEndHour}:00 ` +
    `${ENV.coldCallWeekdaysOnly ? 'weekdays' : 'every day'} (${ENV.bookingTimezone}), cap ${ENV.coldCallDailyCap}/day`,
  );
}
