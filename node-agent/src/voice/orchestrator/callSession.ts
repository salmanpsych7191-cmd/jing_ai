import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { VAD, calcEnergy } from './vad';
import { transcribeAudio } from '../stt/groqWhisper';
import { synthesizeSpeech, getCachedGreeting } from '../tts/deepgramTts';
import { streamVoiceAgentTurn, VoiceMessage } from '../llm/voiceAgent';
import { generateRestaurantNoise, mixNoise, CHUNK_BYTES } from '../audio/noise';
import { analyzeCallTranscript } from '../postCall';
import { ENV, inboundGreetingText } from '../../config/env';
import { twilioVoiceClient, sendWhatsAppMessage } from '../../telephony/twilio';

type CallState = 'greeting' | 'listening' | 'processing' | 'speaking' | 'ended';

// Callers reflexively say "hello?" the instant they pick up, before they've heard
// anything from us — that overlaps the very start of our own greeting/reply. Without
// this grace window, that reflexive word triggers real barge-in and cancels audio
// that was never actually given a chance to play, and since the caller still hasn't
// heard anything they say "hello?" again, repeatedly cancelling every attempt. This
// exact bug (and fix) was verified against real production calls earlier today.
const BARGE_IN_GRACE_MS = 1200;

const FILLER_TRANSCRIPTS = new Set([
  'hello', 'hi', 'hey', 'hello hello', 'anybody there', 'are you there', 'can you hear me', 'who is this',
]);

function isFillerTranscript(text: string): boolean {
  return FILLER_TRANSCRIPTS.has(text.trim().toLowerCase().replace(/[?.!]+$/g, '').trim());
}

const NOISE_LOOP = ENV.voiceAmbientNoiseEnabled ? generateRestaurantNoise(12000, 0.05) : Buffer.alloc(0);

export class CallSession {
  private state: CallState = 'greeting';
  private streamSid: string | null = null;
  private readonly vad = new VAD();
  private readonly history: VoiceMessage[] = [];
  private speakStartedAt = 0;
  private wasInterruptedThisTurn = false;
  private noiseOffset = 0;
  private noiseTimer: NodeJS.Timeout | null = null;

  // Mark-event based playback-completion tracking - waits for Twilio's own ack that
  // audio actually finished playing (not just that we finished sending bytes), since
  // sending is far faster than real-time phone playback. Without this, our own
  // barge-in logic would clear audio that's still mid-playback on Twilio's side.
  private awaitedMark: string | null = null;
  private markResolvers: Array<() => void> = [];

  constructor(
    private readonly callSid: string,
    private readonly ws: WebSocket,
    private readonly phone: string,
    private readonly outbound: boolean,
    private readonly purpose: string | null,
    private readonly greetingText: string,
  ) {
    this.vad.on('speech_start', () => {
      console.log(`[${this.callSid}] VAD: speech_start (state=${this.state})`);
      // Barge-in now runs through the same adaptive VAD signal as normal listening,
      // instead of a second, separately-tuned static energy threshold - two static
      // thresholds that could independently drift out of calibration was strictly
      // worse than one self-calibrating signal driving both.
      if (this.state === 'speaking' && Date.now() - this.speakStartedAt >= BARGE_IN_GRACE_MS) {
        this.wasInterruptedThisTurn = true;
        this.clearTwilioPlayback();
        this.state = 'listening';
        this.startNoiseLoop();
      }
    });
    this.vad.on('speech_end', (buf: Buffer) => {
      console.log(`[${this.callSid}] VAD: speech_end, ${buf.length} bytes (state=${this.state})`);
      this.onSpeechEnd(buf).catch((err) => console.error(`[${this.callSid}] Speech processing error:`, err));
    });
  }

  setStreamSid(sid: string): void {
    this.streamSid = sid;
  }

  private mediaChunkCount = 0;
  private energyMin = Infinity;
  private energyMax = -Infinity;
  private energySum = 0;
  private energyCount = 0;

  handleAudioChunk(base64Payload: string): void {
    if (this.state === 'ended') return;
    const buffer = Buffer.from(base64Payload, 'base64');
    this.mediaChunkCount++;

    const liveEnergy = calcEnergy(buffer);
    this.energyMin = Math.min(this.energyMin, liveEnergy);
    this.energyMax = Math.max(this.energyMax, liveEnergy);
    this.energySum += liveEnergy;
    this.energyCount++;
    if (this.mediaChunkCount % 250 === 0) {
      const avg = this.energyCount ? (this.energySum / this.energyCount).toFixed(1) : 'n/a';
      console.log(
        `[${this.callSid}] Received ${this.mediaChunkCount} inbound chunks (state=${this.state}) ` +
        `energy min=${this.energyMin.toFixed(1)} max=${this.energyMax.toFixed(1)} avg=${avg}`,
      );
      this.energyMin = Infinity;
      this.energyMax = -Infinity;
      this.energySum = 0;
      this.energyCount = 0;
    }

    if (this.state === 'speaking' || this.state === 'listening') {
      this.vad.processChunk(buffer);
    }
  }

  private isEnded(): boolean {
    return this.state === 'ended';
  }

  // ── Background noise loop (plays while listening, so the line never sounds dead-silent) ──

  private startNoiseLoop(): void {
    if (this.noiseTimer || !ENV.voiceAmbientNoiseEnabled) return;
    this.noiseTimer = setInterval(() => {
      if (this.state !== 'listening' || !this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
      const start = this.noiseOffset % (NOISE_LOOP.length - CHUNK_BYTES);
      const chunk = NOISE_LOOP.subarray(start, start + CHUNK_BYTES);
      this.noiseOffset = (this.noiseOffset + CHUNK_BYTES) % NOISE_LOOP.length;
      this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
    }, 20);
  }

  private stopNoiseLoop(): void {
    if (this.noiseTimer) {
      clearInterval(this.noiseTimer);
      this.noiseTimer = null;
    }
  }

  // ── Speech pipeline ──────────────────────────────────────────────────────

  private async onSpeechEnd(audioBuffer: Buffer): Promise<void> {
    if (this.isEnded()) return;
    const cameFromSpeakingUninterrupted = this.state === 'speaking' && !this.wasInterruptedThisTurn;
    const withinGrace = Date.now() - this.speakStartedAt < BARGE_IN_GRACE_MS;

    this.stopNoiseLoop();
    const transcript = await transcribeAudio(audioBuffer);
    if (!transcript) {
      if (this.state !== 'speaking') { this.state = 'listening'; this.startNoiseLoop(); }
      return;
    }

    // The caller was just checking the line is live, not saying something new — our
    // reply was never actually interrupted (grace window suppressed it), so let it
    // keep playing instead of restarting the turn.
    if (cameFromSpeakingUninterrupted && withinGrace && isFillerTranscript(transcript)) {
      return;
    }

    if (this.state === 'speaking') {
      this.wasInterruptedThisTurn = true;
      this.clearTwilioPlayback();
    }

    this.state = 'processing';
    console.log(`[${this.callSid}] User: ${transcript}`);
    await this.processUserSpeech(transcript);
  }

  private async processUserSpeech(transcript: string): Promise<void> {
    this.history.push({ role: 'user', content: transcript });
    try {
      const fullReply = await this.speakStreamed(
        (onSentence) => streamVoiceAgentTurn(this.phone, transcript, this.history.slice(0, -1), this.outbound ? this.purpose : null, onSentence, this.outbound),
      );
      if (fullReply) this.history.push({ role: 'assistant', content: fullReply });
    } catch (err) {
      console.error(`[${this.callSid}] Processing error:`, err);
      try {
        await this.speakOne("Sorry, I'm having a little trouble on my end — give me just a moment and try again?");
      } catch { /* best-effort error recovery */ }
    } finally {
      if (!this.isEnded()) {
        this.state = 'listening';
        this.vad.reset();
        this.startNoiseLoop();
      }
    }
  }

  // Streams sentences from the LLM, pipelining TTS synthesis for sentence N+1 with
  // playback of sentence N so the gap between sentences is close to zero.
  private async speakStreamed(
    runTurn: (onSentence: (s: string) => void) => Promise<{ reply: string; shouldTransfer: boolean }>,
  ): Promise<string> {
    this.state = 'speaking';
    this.speakStartedAt = Date.now();
    this.wasInterruptedThisTurn = false;

    const sentenceQueue: string[] = [];
    let queueWaiter: (() => void) | null = null;
    let producerDone = false;

    const onSentence = (sentence: string) => {
      sentenceQueue.push(sentence);
      if (queueWaiter) { const w = queueWaiter; queueWaiter = null; w(); }
    };

    // A live call must never go silent, no matter what breaks upstream (a hung LLM
    // request, a stalled tool call, anything). This is a hard ceiling independent of
    // the LLM client's own request timeout - it guarantees recovery even if the hang
    // happens somewhere the client-level timeout doesn't cover.
    const TURN_TIMEOUT_MS = 12000;
    let timedOut = false;
    const turnPromise = Promise.race([
      runTurn(onSentence),
      new Promise<{ reply: string; shouldTransfer: boolean }>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          console.warn(`[${this.callSid}] Turn timed out after ${TURN_TIMEOUT_MS}ms, forcing a fallback reply`);
          onSentence("Sorry, that's taking a bit longer than expected — could you say that again?");
          resolve({ reply: '', shouldTransfer: false });
        }, TURN_TIMEOUT_MS);
      }),
    ]).finally(() => {
      producerDone = true;
      if (queueWaiter) { const w = queueWaiter; queueWaiter = null; w(); }
    });

    const nextSentence = async (): Promise<string | null> => {
      while (sentenceQueue.length === 0 && !producerDone) {
        await new Promise<void>((resolve) => { queueWaiter = resolve; });
      }
      return sentenceQueue.length > 0 ? sentenceQueue.shift()! : null;
    };

    let currentText = await nextSentence();
    let currentAudioPromise = currentText ? synthesizeSpeech(currentText) : null;

    while (currentText !== null && !this.wasInterruptedThisTurn && !this.isEnded()) {
      const audio = await currentAudioPromise!;
      if (this.wasInterruptedThisTurn || this.isEnded()) break;
      if (audio.length > 0) await this.streamAudioWithNoiseAndWaitMark(audio);

      const nextTextPromise = nextSentence();
      const [nextText] = await Promise.all([nextTextPromise]);
      const nextAudioPromise = nextText ? synthesizeSpeech(nextText) : null;

      currentText = nextText;
      currentAudioPromise = nextAudioPromise;
    }

    const result = await turnPromise;
    if (result.shouldTransfer && ENV.staffTransferNumber) {
      await new Promise((r) => setTimeout(r, 300));
      await this.executeCallTransfer();
    }
    return result.reply;
  }

  private async speakOne(text: string): Promise<void> {
    this.state = 'speaking';
    this.speakStartedAt = Date.now();
    this.wasInterruptedThisTurn = false;
    const audio = await synthesizeSpeech(text);
    if (audio.length > 0) await this.streamAudioWithNoiseAndWaitMark(audio);
  }

  private async streamAudioWithNoiseAndWaitMark(speech: Buffer): Promise<void> {
    let audio = speech;
    if (ENV.voiceAmbientNoiseEnabled) {
      const mixed = mixNoise(speech, NOISE_LOOP, this.noiseOffset);
      audio = mixed.audio;
      this.noiseOffset = mixed.nextOffset;
    }

    const markName = `reply-${uuidv4().slice(0, 8)}`;
    this.awaitedMark = markName;
    this.sendAudioToTwilio(audio, markName);

    const markWaitStart = Date.now();
    const gotMark = await Promise.race([
      new Promise<boolean>((resolve) => this.markResolvers.push(() => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15000)),
    ]);
    console.log(`[${this.callSid}] mark "${markName}" ${gotMark ? 'acked' : 'TIMED OUT'} after ${Date.now() - markWaitStart}ms`);
  }

  private sendAudioToTwilio(audio: Buffer, markName: string): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[${this.callSid}] sendAudioToTwilio SKIPPED: streamSid=${this.streamSid} readyState=${this.ws.readyState}`);
      return;
    }
    const chunkSize = 640; // ~80ms of mulaw @ 8kHz per frame
    let chunks = 0;
    for (let i = 0; i < audio.length; i += chunkSize) {
      const chunk = audio.subarray(i, i + chunkSize);
      this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
      chunks++;
    }
    this.ws.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: markName } }));
    console.log(`[${this.callSid}] Sent ${chunks} audio chunks (${audio.length} bytes) + mark "${markName}"`);
  }

  // Called from the WS message loop when Twilio echoes back a "mark" event.
  handleMarkEvent(markName: string): void {
    if (markName === this.awaitedMark) {
      this.awaitedMark = null;
      const resolvers = this.markResolvers.splice(0);
      resolvers.forEach((r) => r());
    }
  }

  private clearTwilioPlayback(): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
    const resolvers = this.markResolvers.splice(0);
    resolvers.forEach((r) => r());
  }

  private async executeCallTransfer(): Promise<void> {
    try {
      await sendWhatsAppMessage(ENV.staffTransferNumber, `Call transfer requested during a phone call from ${this.phone}.`);
      const client = twilioVoiceClient();
      if (client) {
        const twiml = `<Response><Dial>${ENV.staffTransferNumber}</Dial></Response>`;
        await client.calls(this.callSid).update({ twiml });
      }
    } catch (err) {
      console.error(`[${this.callSid}] Call transfer failed:`, err);
    }
  }

  async sendGreeting(): Promise<void> {
    if (this.isEnded()) return;
    console.log(`[${this.callSid}] sendGreeting starting, text="${this.greetingText}" streamSid=${this.streamSid}`);
    try {
      // Record the greeting so the LLM won't re-introduce itself on the first turn.
      this.history.push({ role: 'assistant', content: this.greetingText });

      this.state = 'speaking';
      this.speakStartedAt = Date.now();
      this.wasInterruptedThisTurn = false;
      // Only the fixed inbound greeting can be pre-cached - outbound greetings are
      // personalized per call (guest name + purpose) so they're always synthesized live.
      const cached = this.greetingText === inboundGreetingText ? getCachedGreeting() : null;
      const audio = cached ?? await synthesizeSpeech(this.greetingText);
      console.log(`[${this.callSid}] Greeting audio ready: ${audio.length} bytes (cached=${Boolean(cached)})`);
      if (audio.length > 0) await this.streamAudioWithNoiseAndWaitMark(audio);
      console.log(`[${this.callSid}] Greeting playback wait finished`);
    } catch (err) {
      console.error(`[${this.callSid}] Greeting error:`, err);
    } finally {
      if (!this.isEnded()) {
        this.state = 'listening';
        this.startNoiseLoop();
      }
    }
  }

  end(): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.stopNoiseLoop();
    this.vad.reset();
    analyzeCallTranscript(this.callSid, this.phone, this.outbound, this.history).catch((err) =>
      console.error(`[${this.callSid}] Post-call analysis error:`, err));
  }
}
