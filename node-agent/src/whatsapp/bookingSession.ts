import { ENV } from '../config/env';
import { normalizeDate, normalizeTime } from '../db/dates';
import { getSession, saveSession, deleteSession, WhatsAppBookingSession } from '../db/sessions';
import { createBooking, CapacityExceededError, addWaitlistEntry } from '../db/bookings';
import { SESSIONS } from '../knowledge';

export function sessionMessage(stage: string): string {
  const prompts: Record<string, string> = {
    name: 'Welcome to {restaurant}. What name should I book under?',
    date: 'Thanks. What date would you like to reserve? Please send YYYY-MM-DD or a clear date like Friday.',
    time: 'What time should I reserve? Please send HH:MM in 24-hour time, for example 19:30.',
    guests: 'How many guests should I reserve for?',
    special_requests: 'Any special requests, celebrations, or dietary needs?',
    confirm: 'Booking details saved. Reply CONFIRM to create the booking or CANCEL to stop.',
  };
  return (prompts[stage] ?? prompts.name).replace('{restaurant}', ENV.restaurantName);
}

export async function startBookingSession(phone: string): Promise<WhatsAppBookingSession> {
  const session: WhatsAppBookingSession = { phone, stage: 'name' };
  await saveSession(session);
  return session;
}

export async function advanceBookingSession(
  session: WhatsAppBookingSession,
  text: string,
): Promise<[string, WhatsAppBookingSession | null]> {
  const stage = session.stage;
  text = text.trim();

  if (text.toUpperCase() === 'CANCEL') {
    await deleteSession(session.phone);
    return ['Your booking request has been cancelled. Send a new message anytime to start again.', null];
  }

  if (stage === 'name') {
    session.guest_name = text;
    session.stage = 'date';
    await saveSession(session);
    return [sessionMessage('date'), session];
  }

  if (stage === 'date') {
    session.date = normalizeDate(text);
    session.stage = 'time';
    await saveSession(session);
    return [sessionMessage('time'), session];
  }

  if (stage === 'time') {
    session.time = normalizeTime(text);
    session.stage = 'guests';
    await saveSession(session);
    return [sessionMessage('guests'), session];
  }

  if (stage === 'guests') {
    const n = parseInt(text.split(/\s+/)[0], 10);
    if (Number.isNaN(n)) {
      return ['Please reply with a number of guests, for example 4.', session];
    }
    session.guests = Math.max(1, n);
    session.stage = 'special_requests';
    await saveSession(session);
    return [sessionMessage('special_requests'), session];
  }

  if (stage === 'special_requests') {
    session.special_requests = text;
    session.stage = 'confirm';
    await saveSession(session);
    const summary =
      `Guest: ${session.guest_name}\n` +
      `Date: ${session.date}\n` +
      `Time: ${session.time}\n` +
      `Guests: ${session.guests}\n` +
      `Special requests: ${session.special_requests || 'None'}\n\n` +
      'Reply CONFIRM to create the booking or CANCEL to stop.';
    return [summary, session];
  }

  if (stage === 'confirm') {
    if (text.toUpperCase() !== 'CONFIRM') {
      return ['Please reply CONFIRM to create the booking or CANCEL to stop.', session];
    }
    const payload = {
      guest_name: session.guest_name!,
      phone: session.phone,
      date: session.date!,
      time: session.time!,
      guests: Number(session.guests),
      special_requests: session.special_requests ?? '',
    };
    try {
      const booking = await createBooking(payload);
      await deleteSession(session.phone);
      return [
        `Booking confirmed for ${booking.guest_name} on ${booking.date} at ${booking.time}. ` +
        `We have scheduled reminders and saved the booking.`,
        null,
      ];
    } catch (err) {
      if (err instanceof CapacityExceededError) {
        await addWaitlistEntry(
          payload.guest_name, payload.phone, payload.date, err.session, payload.guests,
          'Auto-added: buffet session was fully booked.',
        );
        await deleteSession(session.phone);
        return [
          `That ${SESSIONS[err.session].label.toLowerCase()} seating on ${payload.date} is fully booked ` +
          `(only ${err.seatsRemaining} seat(s) left). I've added you to the waitlist and we'll message you ` +
          `the moment a table opens up. Reply BOOK to try a different date or time instead.`,
          null,
        ];
      }
      throw err;
    }
  }

  await deleteSession(session.phone);
  const newSession = await startBookingSession(session.phone);
  return [sessionMessage('name'), newSession];
}
