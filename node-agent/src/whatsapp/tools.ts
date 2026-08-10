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

// Voice-only knowledge lookup (inbound calls) - keeps the always-loaded system prompt
// compact by fetching long-tail FAQ/menu detail from voice_agent_inbound/knowledge_base.txt
// only when a caller actually asks about it, instead of resending it every turn.
export const VOICE_FAQ_TOOL = {
  type: 'function',
  function: {
    name: 'answer_faq',
    description:
      "Look up an answer for a caller's question about allergies, dietary needs (vegan/vegetarian/gluten-free), " +
      'parking, BYO/alcohol policy, birthdays/cakes/decorations, pets, seating requests, public holiday hours, ' +
      'child-friendliness, wheelchair access, corporate/full-restaurant buyout pricing, the drinks menu, or the ' +
      "detailed food menu. Call this instead of guessing when asked about a topic not already in your core facts.",
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: "Short topic, e.g. 'allergies', 'vegan', 'parking', 'birthday cake', 'corporate buyout', 'drinks menu', 'food menu'." },
      },
      required: ['topic'],
    },
  },
};

export const VOICE_TOOLS = [
  ...AGENT_TOOLS.filter((t) => t.function.name !== 'notify_staff'),
  VOICE_TRANSFER_TOOL,
  VOICE_FAQ_TOOL,
];

// Used only on outbound B2B cold calls (JING Cold Call Script) - a wholly different
// call type from guest-facing reservation calls, so it gets its own small tool set
// instead of being mixed into VOICE_TOOLS.
export const VOICE_LOG_LEAD_TOOL = {
  type: 'function',
  function: {
    name: 'log_corporate_enquiry',
    description:
      'Log a corporate event enquiry captured on this cold call, and notify staff immediately. This is the ' +
      "actual goal of the call - PAX + DATE captured, or a firm callback agreed - not just 'menu sent'. Call " +
      'this once you have enough to log: PAX+date (held), PAX+rough timing with no date (warm), an agreed ' +
      "callback with no event right now (callback), or the contact isn't interested but you still got their " +
      'email (not_keen). Call it near the end of the call, after the key event question has been answered.',
    parameters: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: "The prospect's company name." },
        contact_name: { type: 'string', description: 'Name of the person you spoke with, if given.' },
        pax: { type: ['integer', 'string'], description: 'Approximate headcount for the event/team lunch, if known.' },
        event_date: {
          type: 'string',
          description: "Event date or rough timing as mentioned, e.g. 'end of August' or a specific date. Leave out if none given.",
        },
        status: {
          type: 'string',
          enum: ['held', 'warm', 'callback', 'not_keen'],
          description:
            "'held' = has PAX+date, pencilled in awaiting confirm. 'warm' = has an event but no firm date yet. " +
            "'callback' = no event now but agreed a follow-up call. 'not_keen' = not interested, just wants the menu.",
        },
        email: { type: 'string', description: "Contact's email for the corporate menu/brochure, if given." },
        follow_up_note: { type: 'string', description: "When to follow up, e.g. 'call back in 2 days to confirm' or 'check back in 2 weeks'." },
        summary: { type: 'string', description: 'One-line summary of the call outcome for staff.' },
      },
      required: ['company_name', 'status'],
    },
  },
};

export const VOICE_COLD_CALL_TOOLS = [VOICE_LOG_LEAD_TOOL, VOICE_TRANSFER_TOOL];
