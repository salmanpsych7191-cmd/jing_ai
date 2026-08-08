import { Request, Response } from 'express';
import twilio from 'twilio';
import { ENV, inboundGreetingText } from '../config/env';

const { VoiceResponse } = twilio.twiml;

function wsBase(): string {
  return ENV.publicBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
}

export function webhookVoice(req: Request, res: Response): void {
  if (!ENV.publicBaseUrl) {
    const response = new VoiceResponse();
    response.say("Sorry, the phone assistant isn't fully configured yet. Please call back later.");
    res.type('text/xml').send(response.toString());
    return;
  }

  const from = req.body.From as string;
  const response = new VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: `${wsBase()}/media-stream` });
  stream.parameter({ name: 'phone', value: from });
  stream.parameter({ name: 'greeting', value: inboundGreetingText });
  res.type('text/xml').send(response.toString());
}

export function webhookVoiceOutbound(req: Request, res: Response): void {
  if (!ENV.publicBaseUrl) {
    const response = new VoiceResponse();
    response.say("Sorry, the phone assistant isn't fully configured yet.");
    res.type('text/xml').send(response.toString());
    return;
  }

  const guestName = (req.query.guest_name as string) || 'Guest';
  const purpose = (req.query.purpose as string) || 'a reservation follow-up';
  const to = req.body.To as string;

  const response = new VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: `${wsBase()}/media-stream` });
  stream.parameter({ name: 'phone', value: to });
  stream.parameter({ name: 'purpose', value: purpose });
  stream.parameter({ name: 'outbound', value: 'true' });
  stream.parameter({
    name: 'greeting',
    value: `Hi ${guestName}, this is ${ENV.restaurantName} calling about ${purpose}. Is now a good time to talk?`,
  });
  res.type('text/xml').send(response.toString());
}
