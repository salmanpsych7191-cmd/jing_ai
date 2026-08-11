import { ENV, inboundGreetingText } from '../../config/env';
import { normalizeForTts } from './deepgramTts';
import { encodeMulaw } from '../audio/noise';

export interface SynthesizeOptions {
  energetic?: boolean;
}

// Fish Audio returns raw 16-bit PCM (signed, little-endian) when asked for
// format: 'pcm' - Twilio Media Streams need 8-bit mulaw, so this converts,
// reusing the same G.711 encoder already relied on for ambient noise generation.
function pcm16ToMulaw(pcm: Buffer): Buffer {
  const sampleCount = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = encodeMulaw(pcm.readInt16LE(i * 2));
  }
  return out;
}

export async function synthesizeSpeech(text: string, options: SynthesizeOptions = {}): Promise<Buffer> {
  const cleanText = normalizeForTts(text);
  if (!cleanText) return Buffer.alloc(0);

  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ENV.fishAudioApiKey}`,
      'Content-Type': 'application/json',
      model: ENV.fishAudioModel,
    },
    body: JSON.stringify({
      text: cleanText,
      reference_id: ENV.fishAudioModelId,
      format: 'pcm',
      sample_rate: 8000,
      // No SSML-style pitch/rate control here (unlike Azure) - temperature is the
      // closest available lever, so it's nudged up for the greeting's energy boost.
      temperature: options.energetic ? 0.9 : 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Fish Audio TTS ${response.status}: ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return pcm16ToMulaw(Buffer.from(arrayBuffer));
}

let cachedGreetingAudio: Buffer | null = null;

export async function presynthesizeGreeting(): Promise<void> {
  if (!ENV.fishAudioApiKey) return;
  try {
    cachedGreetingAudio = await synthesizeSpeech(inboundGreetingText, { energetic: true });
    console.log(`[TTS] Pre-synthesized inbound greeting via Fish Audio (${cachedGreetingAudio.length} bytes)`);
  } catch (err) {
    console.warn('[TTS] Could not pre-synthesize greeting at startup, will synthesize live:', err);
  }
}

export function getCachedGreeting(): Buffer | null {
  return cachedGreetingAudio;
}
