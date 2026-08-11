import nodemailer from 'nodemailer';
import { ENV } from '../config/env';

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!ENV.emailFrom || !ENV.emailAppPassword) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: ENV.emailFrom, pass: ENV.emailAppPassword },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return Boolean(ENV.emailFrom && ENV.emailAppPassword && ENV.emailTo);
}

export async function sendEmail(subject: string, html: string): Promise<{ sent: boolean; note: string }> {
  const t = getTransporter();
  if (!t || !ENV.emailTo) {
    return { sent: false, note: 'Email not configured - set EMAIL_FROM, EMAIL_APP_PASSWORD, EMAIL_TO.' };
  }
  await t.sendMail({ from: ENV.emailFrom, to: ENV.emailTo, subject, html });
  return { sent: true, note: `Sent to ${ENV.emailTo}` };
}
