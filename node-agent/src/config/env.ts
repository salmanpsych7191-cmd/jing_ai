import 'dotenv/config';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

// Neon (and historically some other providers) hand out the older "postgres://"
// scheme; the pg driver accepts either, kept for parity with the Python app.
const rawDatabaseUrl = process.env.DATABASE_URL ?? '';

export const ENV = {
  databaseUrl: rawDatabaseUrl.replace(/^postgres:\/\//, 'postgresql://'),
  restaurantName: process.env.RESTAURANT_NAME ?? 'Your Restaurant',
  restaurantPhone: process.env.RESTAURANT_PHONE ?? '',
  googlePlaceId: process.env.GOOGLE_PLACE_ID ?? '',
  googleReviewFallbackUrl: process.env.GOOGLE_REVIEW_FALLBACK_URL ?? '',
  googleRating: (process.env.GOOGLE_RATING ?? '').trim(),
  reviewDelayHours: parseInt(process.env.REVIEW_DELAY_HOURS ?? '2', 10),
  loyaltyThreshold: parseInt(process.env.LOYALTY_THRESHOLD ?? '500', 10),
  loyaltyRewardPct: parseInt(process.env.LOYALTY_REWARD_PCT ?? '20', 10),
  seatingCapacity: parseInt(process.env.SEATING_CAPACITY ?? '90', 10),
  buffetDurationMinutes: parseInt(process.env.BUFFET_DURATION_MINUTES ?? '90', 10),

  // Voice - TTS
  deepgramTtsModel: process.env.DEEPGRAM_TTS_MODEL ?? 'aura-asteria-en',
  auraVoices: [
    'aura-asteria-en', 'aura-luna-en', 'aura-stella-en',
    'aura-athena-en', 'aura-hera-en', 'aura-orion-en',
  ],
  voiceAmbientNoiseEnabled: bool(process.env.VOICE_AMBIENT_NOISE, true),

  // Voice - STT (Groq Whisper batch, replacing Deepgram streaming STT)
  groqSttModel: process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo',

  // Voice - LLM. Kept on Cerebras (not reverted to Groq): Groq's Developer Tier
  // is platform-wide unavailable and llama-3.1-8b-instant shares its free-tier
  // rate-limit pool with the WhatsApp bot below, which caused real dropped call
  // turns in production testing earlier this session.
  voiceLlmProvider: (process.env.VOICE_LLM_PROVIDER ?? 'cerebras').toLowerCase(),
  cerebrasApiKey: process.env.CEREBRAS_API_KEY ?? '',
  voiceLlmModel: process.env.VOICE_GROQ_MODEL ?? 'gemma-4-31b',

  twilioVoiceNumber: process.env.TWILIO_VOICE_NUMBER ?? '',
  staffTransferNumber: process.env.STAFF_TRANSFER_NUMBER ?? '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  dashboardUsername: process.env.DASHBOARD_USERNAME ?? '',
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  verifyTwilioSignature: bool(process.env.VERIFY_TWILIO_SIGNATURE, true),

  twilioWhatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioSandboxCode: process.env.TWILIO_SANDBOX_CODE ?? '',
  bookingTimezone: process.env.BOOKING_TIMEZONE ?? 'UTC',

  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.1-70b-versatile',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? '',

  twilioConfirmationContentSid: process.env.TWILIO_CONFIRMATION_CONTENT_SID ?? '',
  twilioReminderContentSid: process.env.TWILIO_REMINDER_CONTENT_SID ?? '',
  twilioReviewContentSid: process.env.TWILIO_REVIEW_CONTENT_SID ?? '',
  twilioLoyaltyContentSid: process.env.TWILIO_LOYALTY_CONTENT_SID ?? '',
  useWhatsappTemplates: bool(process.env.USE_WHATSAPP_TEMPLATES, false),

  // Cold-call autodialer (bulk CSV upload -> paced outbound dialing)
  coldCallDailyCap: parseInt(process.env.COLD_CALL_DAILY_CAP ?? '100', 10),
  coldCallIntervalMinutes: parseInt(process.env.COLD_CALL_INTERVAL_MINUTES ?? '4', 10),
  coldCallWindowStartHour: parseInt(process.env.COLD_CALL_WINDOW_START_HOUR ?? '10', 10),
  coldCallWindowEndHour: parseInt(process.env.COLD_CALL_WINDOW_END_HOUR ?? '18', 10),
  coldCallWeekdaysOnly: bool(process.env.COLD_CALL_WEEKDAYS_ONLY, true),

  port: parseInt(process.env.PORT ?? '8000', 10),

  // Post-call analysis email (optional - gracefully skipped if unconfigured)
  emailFrom: process.env.EMAIL_FROM ?? '',
  emailAppPassword: process.env.EMAIL_APP_PASSWORD ?? '',
  emailTo: process.env.EMAIL_TO ?? '',
};

export const inboundGreetingText =
  `Hi there, thanks so much for calling ${ENV.restaurantName}! What can I help you with today?`;
