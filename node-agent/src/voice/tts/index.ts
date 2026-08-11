import { ENV } from '../../config/env';
import * as deepgram from './deepgramTts';
import * as azure from './azureTts';
import * as fish from './fishTts';

// Azure Speech has a real Singapore-English voice (en-SG); Deepgram's Aura catalog
// does not (checked against their live /v1/models list - closest is British/Australian/
// American). Fish Audio is a community voice marketplace being trialled at the user's
// request (TTS_PROVIDER=fish) - no official en-SG catalog, just a community-uploaded
// voice, so it's easy to flip back to 'azure' with no code changes if it doesn't work
// out. Provider-switchable via env var, same pattern as VOICE_LLM_PROVIDER.
const provider = ENV.ttsProvider === 'fish' && ENV.fishAudioApiKey
  ? fish
  : ENV.ttsProvider === 'azure' && ENV.azureSpeechKey
    ? azure
    : deepgram;

export const synthesizeSpeech = provider.synthesizeSpeech;
export const presynthesizeGreeting = provider.presynthesizeGreeting;
export const getCachedGreeting = provider.getCachedGreeting;
