import { registerJobHandler } from './index';
import { sendWhatsAppMessage, placeOutboundCall } from '../telephony/twilio';

export function registerAllJobHandlers(): void {
  registerJobHandler('send_whatsapp_message', async (payload) => {
    await sendWhatsAppMessage(payload.phone, payload.body, payload.contentSid ?? null, payload.contentVariables ?? null);
  });

  registerJobHandler('voice_reminder_call', async (payload) => {
    try {
      await placeOutboundCall(payload.phone, payload.guestName, payload.purpose);
    } catch (err) {
      console.error(`Voice reminder call failed for booking ${payload.bookingId}:`, err);
    }
  });
}
