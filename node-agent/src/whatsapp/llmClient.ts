import OpenAI from 'openai';
import { ENV } from '../config/env';

// The WhatsApp bot always uses Groq directly (OpenAI-compatible endpoint) - unlike the
// voice agent, it was never migrated to Cerebras, since WhatsApp text turns aren't
// latency/rate-limit sensitive the way live phone calls are.
export const whatsappClient = ENV.groqApiKey
  ? new OpenAI({ apiKey: ENV.groqApiKey, baseURL: 'https://api.groq.com/openai/v1' })
  : null;
