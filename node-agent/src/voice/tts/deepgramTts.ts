import { ENV, inboundGreetingText } from '../../config/env';

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numToWords(n: number): string {
  if (n === 0) return 'zero';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rem = n % 1000;
    return numToWords(thousands) + ' thousand' + (rem ? ' ' + numToWords(rem) : '');
  }
  return String(n);
}

function timeToWords(h: number, m: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${ONES[hour12] || hour12} ${suffix}`
    : `${ONES[hour12] || hour12} ${numToWords(m)} ${suffix}`;
}

// Rewrites currency/time/number patterns into words a TTS engine pronounces naturally
// (e.g. "$150" -> "one hundred fifty dollars", "3pm" -> "three PM").
export function normalizeForTts(raw: string): string {
  return raw
    .replace(/[*_`#]/g, '')
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h, mnt) => timeToWords(+h, +mnt))
    .replace(/\b(\d{1,2})\s*(am|pm)\b/gi, (_m, h, ap) => `${ONES[+h] || h} ${ap.toUpperCase()}`)
    .replace(/\$\s*(\d+)/g, (_m, n) => numToWords(+n) + ' dollars')
    .replace(/\b(\d{1,4})\b(?![-\d])/g, (_m, n) => numToWords(+n))
    .replace(/\bDr\.\s*/g, 'Doctor ')
    .replace(/\bMr\.\s*/g, 'Mister ')
    .replace(/\bMrs\.\s*/g, 'Missus ')
    .replace(/\bMs\.\s*/g, 'Miss ')
    .replace(/%/g, ' percent')
    .replace(/&/g, ' and ')
    .trim();
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const cleanText = normalizeForTts(text);
  if (!cleanText) return Buffer.alloc(0);

  const url = `https://api.deepgram.com/v1/speak?model=${ENV.deepgramTtsModel}&encoding=mulaw&sample_rate=8000&container=none`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${ENV.deepgramApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: cleanText }),
  });

  if (!response.ok) {
    throw new Error(`Deepgram TTS ${response.status}: ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

let cachedGreetingAudio: Buffer | null = null;

// Synthesizes the fixed inbound greeting once at startup so the first caller of the
// day doesn't pay for a live TTS round-trip before hearing anything. Outbound
// greetings are personalized per-call (guest name + purpose) so they stay live.
export async function presynthesizeGreeting(): Promise<void> {
  if (!ENV.deepgramApiKey) return;
  try {
    cachedGreetingAudio = await synthesizeSpeech(inboundGreetingText);
    console.log(`[TTS] Pre-synthesized inbound greeting (${cachedGreetingAudio.length} bytes)`);
  } catch (err) {
    console.warn('[TTS] Could not pre-synthesize greeting at startup, will synthesize live:', err);
  }
}

export function getCachedGreeting(): Buffer | null {
  return cachedGreetingAudio;
}
