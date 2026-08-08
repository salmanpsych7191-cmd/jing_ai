// Tool schemas shared by the WhatsApp AI concierge and (with notify_staff swapped for
// transfer_to_staff) the voice agent. Ported verbatim from AGENT_TOOLS in the Python app.
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check remaining buffet seats and per-person price for a given date and session before booking.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: "ISO date YYYY-MM-DD. Resolve relative terms like 'Friday' or 'next week' to a real date yourself first." },
          session: { type: 'string', enum: ['lunch', 'dinner'], description: 'Buffet session.' },
          guests: { type: ['integer', 'string'], description: 'Party size, as a number.' },
        },
        required: ['date', 'session'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description:
        'Create a confirmed buffet reservation once the guest has given name, date, time, and party size, ' +
        'and has explicitly confirmed they want to book. If the session is full, the guest is automatically ' +
        'waitlisted instead.',
      parameters: {
        type: 'object',
        properties: {
          guest_name: { type: 'string' },
          date: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
          time: { type: 'string', description: '24-hour HH:MM.' },
          guests: { type: ['integer', 'string'], description: 'Party size, as a number.' },
          special_requests: { type: 'string', description: 'Dietary notes, celebrations, soup base preference, etc.' },
        },
        required: ['guest_name', 'date', 'time', 'guests'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_bookings',
      description: "Look up this guest's upcoming bookings by their WhatsApp phone number.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_loyalty_status',
      description: "Look up this guest's loyalty points, visit count, and voucher status.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'join_waitlist',
      description: 'Add the guest to the waitlist for a date/session that is fully booked.',
      parameters: {
        type: 'object',
        properties: {
          guest_name: { type: 'string' },
          date: { type: 'string' },
          session: { type: 'string', enum: ['lunch', 'dinner'] },
          guests: { type: ['integer', 'string'], description: 'Party size, as a number.' },
          notes: { type: 'string' },
        },
        required: ['guest_name', 'date', 'session', 'guests'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_review_link',
      description: 'Get the Google review link to share with a guest who wants to leave feedback.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_link',
      description:
        'Text the guest a link via WhatsApp instead of reading a long URL aloud. Use this on phone calls ' +
        'whenever a guest wants the menu, a review link, Instagram/Facebook, or the website — sends to ' +
        "their own phone number, which is already known.",
      parameters: {
        type: 'object',
        properties: {
          link_type: {
            type: 'string',
            enum: ['review', 'menu', 'instagram', 'facebook', 'website', 'opentable'],
            description: 'Which link to send.',
          },
        },
        required: ['link_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_staff',
      description:
        "Notify restaurant staff directly via WhatsApp with the guest's contact info and request. Use this " +
        'for group bookings, private events, or large parties — these need a human to arrange, not the AI. ' +
        "On a phone call, also use transfer_to_staff alongside this so staff both get a live call and a " +
        "written note in case the call isn't picked up.",
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: "What the guest wants, e.g. '20-person birthday event on Dec 5'." },
        },
        required: ['reason'],
      },
    },
  },
];

export const VOICE_TRANSFER_TOOL = {
  type: 'function',
  function: {
    name: 'transfer_to_staff',
    description:
      "Transfer this live phone call to a staff member. Use when the caller asks for a person, has a request " +
      "you can't handle, seems frustrated, or wants a group booking / private event / large party.",
    parameters: { type: 'object', properties: {} },
  },
};

export const VOICE_TOOLS = [
  ...AGENT_TOOLS.filter((t) => t.function.name !== 'notify_staff'),
  VOICE_TRANSFER_TOOL,
];
