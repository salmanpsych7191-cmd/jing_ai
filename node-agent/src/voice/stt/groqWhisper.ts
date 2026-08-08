import Groq from 'groq-sdk';
import { ENV } from '../../config/env';

const groq = ENV.groqApiKey ? new Groq({ apiKey: ENV.groqApiKey }) : null;
const MIN_AUDIO_BYTES = 2400; // ~300ms at 8kHz - skip short noise bursts

export async function transcribeAudio(mulaw: Buffer): Promise<string> {
  if (!groq || mulaw.length < MIN_AUDIO_BYTES) return '';

  const pcm = mulawToPcm16(mulaw);
  const wav = pcm16ToWav(pcm, 8000);
  const file = new File([new Uint8Array(wav)], 'audio.wav', { type: 'audio/wav' });

  const result = await groq.audio.transcriptions.create({
    file,
    model: ENV.groqSttModel,
    response_format: 'text',
    language: 'en',
    temperature: 0,
  });

  return (result as unknown as string).trim();
}

// G.711 mu-law decode -> signed 16-bit PCM samples
function mulawToPcm16(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    const u = ~mulaw[i] & 0xff;
    let t = ((u & 0x0f) << 3) + 0x84;
    t <<= (u & 0x70) >> 4;
    const sample = u & 0x80 ? 0x84 - t : t - 0x84;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return pcm;
}

// Wrap raw PCM16 in a standard 44-byte WAV/RIFF header - Groq's transcription
// endpoint needs a real audio container, not headerless PCM.
function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
