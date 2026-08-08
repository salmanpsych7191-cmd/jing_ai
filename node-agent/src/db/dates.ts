import { ENV } from '../config/env';

// All dates/times are stored and reasoned about in the restaurant's local timezone
// (BOOKING_TIMEZONE, e.g. Asia/Singapore), matching the Python app's zoneinfo usage.
export function nowLocal(): Date {
  // JS Date has no built-in timezone-aware arithmetic; we keep it simple by treating
  // the process TZ as authoritative (set via the TZ env var on the host, same as the
  // Python app relies on ZoneInfo(BOOKING_TIMEZONE) - both need the host configured).
  return new Date();
}

export function nowIsoLocal(): string {
  return new Date().toISOString();
}

export function todayIsoLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ENV.bookingTimezone }).format(new Date());
}

export function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'today' || lowered === 'tonight') return todayIsoLocal();
  if (lowered === 'tomorrow') {
    const d = new Date(`${todayIsoLocal()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  let m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return trimmed;
}

export function normalizeTime(value: string): string {
  let v = value.trim().toLowerCase().replace(/ /g, '');
  if (v.endsWith('pm') || v.endsWith('am')) {
    const meridiem = v.slice(-2);
    const hourMinute = v.slice(0, -2);
    let hourStr = hourMinute;
    let minuteStr = '00';
    if (hourMinute.includes(':')) {
      [hourStr, minuteStr] = hourMinute.split(':');
    }
    let hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  if (/^\d{4}$/.test(v)) return `${v.slice(0, 2)}:${v.slice(2)}`;
  return v;
}

// Combines a date + time (both local wall-clock) into a real Date for reminder math.
export function toBookingDateTime(dateStr: string, timeStr: string): Date {
  const normalizedDate = normalizeDate(dateStr);
  return new Date(`${normalizedDate}T${timeStr}:00`);
}
