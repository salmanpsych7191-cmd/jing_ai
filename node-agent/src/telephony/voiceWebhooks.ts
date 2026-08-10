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

  const callType = (req.query.call_type as string) === 'booking_reminder' ? 'booking_reminder' : 'cold_call';
  const to = req.body.To as string;

  const response = new VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: `${wsBase()}/media-stream` });
  stream.parameter({ name: 'phone', value: to });
  stream.parameter({ name: 'outbound', value: 'true' });
  stream.parameter({ name: 'callType', value: callType });

  if (callType === 'booking_reminder') {
    const guestName = (req.query.guest_name as string) || 'Guest';
    const purpose = (req.query.purpose as string) || 'a reservation follow-up';
    stream.parameter({ name: 'purpose', value: purpose });
    stream.parameter({
      name: 'greeting',
      value: `Hi ${guestName}, this is Mel from ${ENV.restaurantName} calling about ${purpose}. Is now a good time to talk?`,
    });
  } else {
    const companyName = (req.query.company_name as string) || '';
    const contactName = (req.query.contact_name as string) || '';
    stream.parameter({ name: 'companyName', value: companyName });
    if (contactName) stream.parameter({ name: 'contactName', value: contactName });
    // Cold-call convention: open with real energy, not a flat/formal tone - this is
    // the caller's one shot at a first impression, and it's also given the strongest
    // TTS energy boost (see callSession.sendGreeting's { energetic: true }).
    const greeting = contactName
      ? `Hi there! Is this ${contactName}?`
      : "Hi there! Could I speak with whoever handles staff events, team lunches, or company celebrations there?";
    stream.parameter({ name: 'greeting', value: greeting });
  }
  res.type('text/xml').send(response.toString());
}
