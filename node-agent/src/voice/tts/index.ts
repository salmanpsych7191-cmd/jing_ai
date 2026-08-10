import { ENV } from '../../config/env';
import * as deepgram from './deepgramTts';
import * as azure from './azureTts';

// Azure Speech has a real Singapore-English voice (en-SG); Deepgram's Aura catalog
// does not (checked against their live /v1/models list - closest is British/Australian/
// American). Provider-switchable via env var, same pattern as VOICE_LLM_PROVIDER, so
// this can fall back to Deepgram if the Azure resource/quota ever becomes unavailable.
const useAzure = ENV.ttsProvider === 'azure' && Boolean(ENV.azureSpeechKey);
const provider = useAzure ? azure : deepgram;

export const synthesizeSpeech = provider.synthesizeSpeech;
export const presynthesizeGreeting = provider.presynthesizeGreeting;
export const getCachedGreeting = provider.getCachedGreeting;
