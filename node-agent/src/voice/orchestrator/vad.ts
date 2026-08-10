import { EventEmitter } from 'events';

// Energy-based voice-activity detection directly on raw mulaw bytes (no PCM decode
// needed - the byte's distance from the mulaw silence value 0xff is already a usable
// energy proxy). This replaces the free "SpeechStarted"/interim-transcript signal
// Deepgram's streaming STT gave us; Groq Whisper is REST batch, so we have to know
// ourselves when the caller started and stopped talking before we can even send audio.
//
// A single hardcoded energy threshold was tried and proved unworkable: real call data
// showed one call's baseline noise floor peaking at 150 (needing a threshold above
// that), while a DIFFERENT call's genuine speech never exceeded ~157 (so that same
// raised threshold missed it entirely). Baseline noise varies call-to-call (carrier
// route, phone hardware, environment) enough that no single global number works
// reliably. Instead, this tracks a per-call adaptive noise floor and classifies speech
// as a RELATIVE jump above it - self-calibrating to whatever this specific call's
// conditions actually are instead of guessing a universal constant.
const SPEECH_MARGIN = 45; // how far above the tracked floor counts as speech
const FLOOR_SEED = 30; // initial guess before any real data for this call exists
const FLOOR_DECAY_DOWN = 0.9; // fast: quickly trust quieter audio as the new floor
const FLOOR_DECAY_UP = 0.995; // slow: a burst of speech shouldn't redefine "quiet"
const MIN_AUDIO_BYTES = 6400; // ~800ms minimum speech before treating it as a real utterance
// Was 600ms - too short in practice: a caller's mid-sentence pause (e.g. "yes, we do
// have... [pause] ...an event coming up") got cut as a finished utterance, sending a
// fragment to the LLM and producing a reply that then sounded repeated once the rest
// of the sentence arrived as a second turn. 2s gives a real pause room to happen.
const SILENCE_MS = 2000;

export class VAD extends EventEmitter {
  private audioBuffer: Buffer[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private isSpeaking = false;
  private noiseFloor = FLOOR_SEED;

  processChunk(buffer: Buffer): void {
    const energy = calcEnergy(buffer);

    // Floor updates on every chunk (not just quiet ones) so it can never get
    // permanently stuck - it just moves toward quiet audio fast and toward loud
    // audio slowly, which lets genuine relative speech bursts still stand out.
    this.noiseFloor = energy < this.noiseFloor
      ? this.noiseFloor * FLOOR_DECAY_DOWN + energy * (1 - FLOOR_DECAY_DOWN)
      : this.noiseFloor * FLOOR_DECAY_UP + energy * (1 - FLOOR_DECAY_UP);

    const threshold = this.noiseFloor + SPEECH_MARGIN;

    if (energy > threshold) {
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
    this.noiseFloor = FLOOR_SEED;
  }
}

export function calcEnergy(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += Math.abs(buffer[i] - 0xff);
  return sum / buffer.length;
}
