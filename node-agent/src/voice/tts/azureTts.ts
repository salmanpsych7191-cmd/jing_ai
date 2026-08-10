import { ENV, inboundGreetingText } from '../../config/env';
import { normalizeForTts } from './deepgramTts';

let cachedToken: { token: string; expiresAt: number } | null = null;

// Azure STS tokens are valid ~10 min; refreshed a minute early to avoid a request
// racing the expiry. The custom-domain endpoint is required here - the shared
// regional token endpoint (southeastasia.api.cognitive.microsoft.com) returned a
// generic gateway 400 in testing, while the account's own custom-domain endpoint
// (created via --custom-domain on the Cognitive Services resource) worked correctly.
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const response = await fetch(`https://${ENV.azureSpeechCustomDomain}.cognitiveservices.azure.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': ENV.azureSpeechKey },
  });
  if (!response.ok) {
    throw new Error(`Azure Speech token fetch failed: ${response.status} ${await response.text()}`);
  }
  const token = await response.text();
  cachedToken = { token, expiresAt: Date.now() + 9 * 60 * 1000 };
  return token;
}

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// A static pitch/rate boost applied identically to every single utterance sounded
// flat and robotic in testing - real speech varies sentence to sentence. Jittering
// within a small range per utterance (still centered on the configured base) breaks
// that uniformity without making individual sentences sound inconsistent.
const PITCH_JITTER_PERCENT = 4;
const RATE_JITTER_PERCENT = 4;

// A noticeably stronger boost for opening greetings specifically. Every utterance
// getting the same conversational-level boost meant the greeting had no more energy
// than a mid-call answer - real cold-call/front-desk convention is to open with
// visibly more energy than the rest of the conversation.
const ENERGETIC_PITCH = '+22%';
const ENERGETIC_RATE = '+14%';

export interface SynthesizeOptions {
  energetic?: boolean;
}

function jitteredProsodyValue(base: string, jitterRange: number): string {
  const match = base.match(/^([+-]?\d+(?:\.\d+)?)%$/);
  const baseVal = match ? parseFloat(match[1]) : 0;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  const value = Math.round(baseVal + jitter);
  return `${value >= 0 ? '+' : ''}${value}%`;
}

// Short pauses at natural clause boundaries - a human doesn't deliver a whole sentence
// as one unbroken stream, they pause briefly at commas/dashes/trailing thoughts. Applied
// to already-SSML-escaped text, so the inserted tags are safe from further escaping.
function withNaturalPauses(escapedText: string): string {
  return escapedText
    .replace(/,\s+/g, ', <break time="160ms"/> ')
    .replace(/\s+—\s+/g, ' <break time="220ms"/> ')
    .replace(/\.\.\.\s*/g, '... <break time="250ms"/> ');
}

export async function synthesizeSpeech(text: string, options: SynthesizeOptions = {}): Promise<Buffer> {
  const cleanText = normalizeForTts(text);
  if (!cleanText) return Buffer.alloc(0);

  const token = await getAccessToken();
  const gender = ENV.azureSpeechVoice.toLowerCase().includes('wayne') ? 'Male' : 'Female';
  const pitchBase = options.energetic ? ENERGETIC_PITCH : ENV.azureSpeechPitch;
  const rateBase = options.energetic ? ENERGETIC_RATE : ENV.azureSpeechRate;
  const pitch = jitteredProsodyValue(pitchBase, PITCH_JITTER_PERCENT);
  const rate = jitteredProsodyValue(rateBase, RATE_JITTER_PERCENT);
  const ssml =
    `<speak version="1.0" xml:lang="en-SG">` +
    `<voice xml:lang="en-SG" xml:gender="${gender}" name="${ENV.azureSpeechVoice}">` +
    `<prosody pitch="${pitch}" rate="${rate}">${withNaturalPauses(escapeSsml(cleanText))}</prosody>` +
    `</voice>` +
    `</speak>`;

  const response = await fetch(`https://${ENV.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-8khz-8bit-mono-mulaw',
      'User-Agent': 'jingnodeagent',
    },
    body: ssml,
  });

  if (!response.ok) {
    throw new Error(`Azure Speech TTS ${response.status}: ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

let cachedGreetingAudio: Buffer | null = null;

export async function presynthesizeGreeting(): Promise<void> {
  if (!ENV.azureSpeechKey) return;
  try {
    cachedGreetingAudio = await synthesizeSpeech(inboundGreetingText, { energetic: true });
    console.log(`[TTS] Pre-synthesized inbound greeting via Azure Speech (${cachedGreetingAudio.length} bytes)`);
  } catch (err) {
    console.warn('[TTS] Could not pre-synthesize greeting at startup, will synthesize live:', err);
  }
}

export function getCachedGreeting(): Buffer | null {
  return cachedGreetingAudio;
}
