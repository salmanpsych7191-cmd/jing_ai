import { EventEmitter } from 'events';

// Energy-based voice-activity detection directly on raw mulaw bytes (no PCM decode
// needed - the byte's distance from the mulaw silence value 0xff is already a usable
// energy proxy). This replaces the free "SpeechStarted"/interim-transcript signal
// Deepgram's streaming STT gave us; Groq Whisper is REST batch, so we have to know
// ourselves when the caller started and stopped talking before we can even send audio.
// Real production data from a live call (India mobile carrier route) showed a baseline
// noise floor of 43-150 (avg ~75-87) even during silence - the original value of 20,
// copied unchanged from a reference project tuned for a different call path, was below
// the noise floor entirely, so isSpeaking never reset and speech_end never fired no
// matter what the caller said. Set well above the observed max with a safety margin;
// this is a first pass based on one call's data, not a universal calibration - a static
// threshold is inherently fragile across different carrier routes and may need further
// tuning against more real calls.
const ENERGY_THRESHOLD = 220;
const MIN_AUDIO_BYTES = 6400; // ~800ms minimum speech before treating it as a real utterance
const SILENCE_MS = 600; // how long a caller must go quiet before we treat the utterance as finished

export class VAD extends EventEmitter {
  private audioBuffer: Buffer[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private isSpeaking = false;

  processChunk(buffer: Buffer): void {
    const energy = calcEnergy(buffer);
    if (energy > ENERGY_THRESHOLD) {
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.emit('speech_start');
      }
      this.audioBuffer.push(buffer);
      this.armSilenceTimer();
    } else if (this.isSpeaking) {
      // Keep collecting through brief silence too, so words aren't clipped at boundaries.
      this.audioBuffer.push(buffer);
    }
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.isSpeaking) {
        const full = Buffer.concat(this.audioBuffer);
        this.isSpeaking = false;
        this.audioBuffer = [];
        if (full.length > MIN_AUDIO_BYTES) {
          this.emit('speech_end', full);
        }
      }
    }, SILENCE_MS);
  }

  reset(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.audioBuffer = [];
    this.isSpeaking = false;
  }
}

export function calcEnergy(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += Math.abs(buffer[i] - 0xff);
  return sum / buffer.length;
}
