// Ambient background noise for a busy-restaurant feel during calls.
// All audio is mulaw 8-bit, 8 kHz mono - matching Twilio's Media Streams format.

const SAMPLE_RATE = 8000;
export const CHUNK_BYTES = 160; // 20 ms at 8 kHz

// G.711 mu-law encode / decode - exported for reuse by TTS providers (e.g. Fish
// Audio) that return raw 16-bit PCM instead of mulaw directly.
export function encodeMulaw(s: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) { /* find exponent */ }
  const mantissa = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mantissa) & 0xff;
}

function decodeMulaw(u: number): number {
  u = ~u & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

/**
 * Generates a seamlessly loopable mulaw buffer that sounds like a busy restaurant
 * dining room: low rumble (kitchen/HVAC) + distant, indistinct chatter.
 * amplitude: 0-1 scale; 0.04-0.06 is barely audible but adds warmth.
 */
export function generateRestaurantNoise(durationMs: number, amplitude = 0.05): Buffer {
  const samples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buf = Buffer.alloc(samples);

  let brown = 0; // leaky integrator -> low-frequency rumble
  let envPhase1 = 0;
  let envPhase2 = 0; // two independent speech-rhythm envelopes ("voices")
  let chatter = 0; // band-limited chatter texture

  for (let i = 0; i < samples; i++) {
    brown += (Math.random() - 0.5) * 0.05;
    brown *= 0.997;

    envPhase1 += (2 * Math.PI * 1.3) / SAMPLE_RATE;
    envPhase2 += (2 * Math.PI * 2.1) / SAMPLE_RATE;
    const env = 0.55 + 0.25 * Math.sin(envPhase1) + 0.2 * Math.sin(envPhase2);

    chatter = chatter * 0.85 + (Math.random() - 0.5) * 0.15;

    const raw = (brown * 0.6 + chatter * env * 0.4) * amplitude;
    const clamped = Math.max(-32767, Math.min(32767, Math.floor(raw * 32767)));
    buf[i] = encodeMulaw(clamped);
  }

  return buf;
}

/** Mixes background noise into a mulaw speech buffer. Returns the mixed buffer and the next noise loop offset. */
export function mixNoise(
  speech: Buffer,
  noiseLoop: Buffer,
  noiseOffset: number,
  bgGain = 0.1,
): { audio: Buffer; nextOffset: number } {
  const out = Buffer.alloc(speech.length);
  let offset = noiseOffset;

  for (let i = 0; i < speech.length; i++) {
    const speechPcm = decodeMulaw(speech[i]);
    const noisePcm = decodeMulaw(noiseLoop[offset % noiseLoop.length]);
    offset++;
    const mixed = Math.floor(speechPcm * (1 - bgGain) + noisePcm * bgGain);
    out[i] = encodeMulaw(Math.max(-32767, Math.min(32767, mixed)));
  }

  return { audio: out, nextOffset: offset % noiseLoop.length };
}
