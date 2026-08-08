import { registerJobHandler } from './index';
import { sendWhatsAppMessage } from '../telephony/twilio';

export function registerAllJobHandlers(): void {
  registerJobHandler('send_whatsapp_message', async (payload) => {
    await sendWhatsAppMessage(payload.phone, payload.body, payload.contentSid ?? null, payload.contentVariables ?? null);
  });
}
