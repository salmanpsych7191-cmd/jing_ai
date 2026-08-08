import { ENV } from '../config/env';
import { twilioClient } from '../telephony/twilio';

export async function voiceDiagnostics() {
  let trialAccount: boolean | null = null;
  let transferNumberVerified: boolean | null = null;
  let transferWarning: string | null = null;
  let voiceNumberOwned: boolean | null = null;

  const client = twilioClient();
  if (client && ENV.twilioAccountSid) {
    try {
      const account = await client.api.v2010.accounts(ENV.twilioAccountSid).fetch();
      trialAccount = account.type === 'Trial';
    } catch (err) {
      transferWarning = `Could not check Twilio account type: ${err}`;
    }

    if (ENV.twilioVoiceNumber) {
      try {
        const owned = await client.incomingPhoneNumbers.list({ phoneNumber: ENV.twilioVoiceNumber });
        voiceNumberOwned = owned.length > 0 && Boolean(owned[0].capabilities?.voice);
      } catch {
        voiceNumberOwned = null;
      }
    }

    if (trialAccount && ENV.staffTransferNumber) {
      try {
        const verified = await client.outgoingCallerIds.list();
        transferNumberVerified = verified.some((v) => v.phoneNumber === ENV.staffTransferNumber);
        if (!transferNumberVerified) {
          transferWarning =
            `This is a Twilio Trial account, and ${ENV.staffTransferNumber} is not a verified ` +
            'Caller ID on it — call transfer will fail until the account is upgraded or that ' +
            'number is verified in the Twilio console.';
        }
      } catch (err) {
        transferWarning = `Could not check verified caller IDs: ${err}`;
      }
    }
  }

  const transferReady = Boolean(ENV.staffTransferNumber) && transferNumberVerified !== false;
  const missing = [
    ['TWILIO_VOICE_NUMBER', ENV.twilioVoiceNumber],
    ['STAFF_TRANSFER_NUMBER', ENV.staffTransferNumber],
    ['PUBLIC_BASE_URL', ENV.publicBaseUrl],
  ].filter(([, v]) => !v).map(([name]) => name);

  return {
    deepgram_configured: Boolean(ENV.deepgramApiKey),
    stt_model: ENV.groqSttModel,
    tts_model: ENV.deepgramTtsModel,
    tts_voices_available: ENV.auraVoices,
    voice_llm_model: ENV.voiceLlmModel,
    twilio_voice_number: ENV.twilioVoiceNumber || null,
    twilio_voice_number_owned: voiceNumberOwned,
    staff_transfer_number: ENV.staffTransferNumber || null,
    public_base_url: ENV.publicBaseUrl || null,
    trial_account: trialAccount,
    ready_for_calls: Boolean(
      ENV.deepgramApiKey && ENV.twilioAccountSid && ENV.twilioAuthToken && ENV.twilioVoiceNumber && ENV.publicBaseUrl,
    ),
    transfer_ready: transferReady,
    transfer_warning: transferWarning,
    missing,
  };
}
