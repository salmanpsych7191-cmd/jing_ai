import twilio from 'twilio';
import { ENV } from '../config/env';
import { insertMessage } from '../db/messages';

let lastTwilioError: string | null = null;

export function getLastTwilioError(): string | null {
  return lastTwilioError;
}

export function twilioClient(): ReturnType<typeof twilio> | null {
  if (!(ENV.twilioAccountSid && ENV.twilioAuthToken && ENV.twilioWhatsappNumber)) return null;
  return twilio(ENV.twilioAccountSid, ENV.twilioAuthToken);
}

// A separate client usable even when the WhatsApp number isn't configured (voice-only
// setups) - mirrors Python's twilio_client() being reused broadly, but voice call-out
// only needs account SID/token, not a WhatsApp sender.
export function twilioVoiceClient(): ReturnType<typeof twilio> | null {
  if (!(ENV.twilioAccountSid && ENV.twilioAuthToken)) return null;
  return twilio(ENV.twilioAccountSid, ENV.twilioAuthToken);
}

// Shared by the manual "call now" API route and the scheduled booking-reminder call
// job, so both place calls exactly the same way.
export async function placeOutboundCall(phone: string, guestName: string, purpose: string): Promise<string> {
  const client = twilioVoiceClient();
  if (!client) throw new Error('Twilio client not configured.');
  const call = await client.calls.create({
    to: phone,
    from: ENV.twilioVoiceNumber,
    url:
      `${ENV.publicBaseUrl}/webhook/voice-outbound` +
      `?guest_name=${encodeURIComponent(guestName)}&purpose=${encodeURIComponent(purpose)}`,
  });
  return call.sid;
}

export async function sendWhatsAppMessage(
  phone: string,
  body: string,
  contentSid?: string | null,
  contentVariables?: Record<string, string> | null,
): Promise<boolean> {
  const client = twilioClient();
  if (!client) {
    lastTwilioError = 'Twilio credentials or WhatsApp sender are missing';
    return false;
  }
  try {
    const params: Record<string, string> = {
      from: ENV.twilioWhatsappNumber,
      to: `whatsapp:${phone}`,
    };
    if (ENV.useWhatsappTemplates && contentSid) {
      params.contentSid = contentSid;
      if (contentVariables) params.contentVariables = JSON.stringify(contentVariables);
    } else {
      params.body = body;
    }
    await client.messages.create(params as any);
    lastTwilioError = null;
    await insertMessage(phone, 'out', body);
    return true;
  } catch (err: any) {
    await insertMessage(phone, 'out', `[send-failed] ${body}`);
    lastTwilioError = String(err?.message ?? err);
    console.error(`Twilio send failed for ${phone}:`, err);
    return false;
  }
}

export function sandboxJoinUrl(): string | null {
  const rawNumber = ENV.twilioWhatsappNumber.replace('whatsapp:', '').replace('+', '');
  if (!rawNumber || !ENV.twilioSandboxCode) return null;
  let code = ENV.twilioSandboxCode.trim().toLowerCase();
  if (code.startsWith('join ')) code = code.slice(5).trim();
  const encodedMessage = `join ${code}`.replace(/ /g, '%20');
  return `https://api.whatsapp.com/send/?phone=${rawNumber}&text=${encodedMessage}&type=phone_number&app_absent=0`;
}

export function twilioDiagnostics() {
  const configured = Boolean(ENV.twilioAccountSid && ENV.twilioAuthToken && ENV.twilioWhatsappNumber);
  const senderFormatOk =
    ENV.twilioWhatsappNumber.startsWith('whatsapp:+') && !ENV.twilioWhatsappNumber.startsWith('whatsapp:++');
  const templateConfigured = Boolean(ENV.twilioConfirmationContentSid);
  const sandboxUrl = sandboxJoinUrl();
  let sandboxCode = ENV.twilioSandboxCode.trim().toLowerCase();
  if (sandboxCode.startsWith('join ')) sandboxCode = sandboxCode.slice(5).trim();

  return {
    configured,
    sender: ENV.twilioWhatsappNumber,
    sender_format_ok: senderFormatOk,
    account_sid_present: Boolean(ENV.twilioAccountSid),
    auth_token_present: Boolean(ENV.twilioAuthToken),
    templates_configured: templateConfigured,
    confirmation_template: ENV.twilioConfirmationContentSid || null,
    reminder_template: ENV.twilioReminderContentSid || null,
    review_template: ENV.twilioReviewContentSid || null,
    loyalty_template: ENV.twilioLoyaltyContentSid || null,
    last_error: lastTwilioError,
    sandbox_url: sandboxUrl,
    sandbox_instructions: sandboxUrl
      ? `Open the link and send 'join ${sandboxCode}' from WhatsApp to start testing.`
      : 'Add TWILIO_SANDBOX_CODE to .env to generate the WhatsApp join link.',
    advice:
      configured && templateConfigured
        ? 'WhatsApp templates are configured. Business-initiated messages will use them.'
        : configured
          ? 'Sender configured but no content templates set - business-initiated messages will use plain body text (session-window only).'
          : 'Twilio WhatsApp is not fully configured - set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER.',
  };
}

// Rejects webhook calls that aren't genuinely from Twilio (spoofed bookings/messages/calls).
export function verifyTwilioSignature(
  signature: string,
  fullUrl: string,
  params: Record<string, string>,
): boolean {
  if (!ENV.verifyTwilioSignature || !ENV.twilioAuthToken) return true;
  return twilio.validateRequest(ENV.twilioAuthToken, signature, fullUrl, params);
}
