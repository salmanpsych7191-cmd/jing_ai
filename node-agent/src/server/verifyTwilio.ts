import { Request, Response, NextFunction } from 'express';
import { verifyTwilioSignature } from '../telephony/twilio';
import { ENV } from '../config/env';

// Rejects webhook calls that aren't genuinely from Twilio (spoofed bookings/messages/calls).
// Includes the query string in the signature base URL — a real bug fixed in the Python
// app earlier this session (Twilio signs the full URL including query params; omitting
// them made every outbound-call webhook fail signature validation in production).
export function verifyTwilioMiddleware(req: Request, res: Response, next: NextFunction): void {
  const signature = (req.headers['x-twilio-signature'] as string) ?? '';
  const baseUrl = ENV.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  let fullUrl = `${baseUrl}${req.path}`;
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  if (queryString) fullUrl += `?${queryString}`;

  if (verifyTwilioSignature(signature, fullUrl, req.body)) {
    next();
    return;
  }
  res.status(403).json({ detail: 'Invalid Twilio signature' });
}
