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

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const cleanText = normalizeForTts(text);
  if (!cleanText) return Buffer.alloc(0);

  const token = await getAccessToken();
  const gender = ENV.azureSpeechVoice.toLowerCase().includes('wayne') ? 'Male' : 'Female';
  const ssml =
    `<speak version="1.0" xml:lang="en-SG">` +
    `<voice xml:lang="en-SG" xml:gender="${gender}" name="${ENV.azureSpeechVoice}">${escapeSsml(cleanText)}</voice>` +
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
    cachedGreetingAudio = await synthesizeSpeech(inboundGreetingText);
    console.log(`[TTS] Pre-synthesized inbound greeting via Azure Speech (${cachedGreetingAudio.length} bytes)`);
  } catch (err) {
    console.warn('[TTS] Could not pre-synthesize greeting at startup, will synthesize live:', err);
  }
}

export function getCachedGreeting(): Buffer | null {
  return cachedGreetingAudio;
}
