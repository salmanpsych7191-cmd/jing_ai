// Static business knowledge for JING | Halal Hotpot & Grill Buffet.
// Ported verbatim from restaurant_agent/knowledge.py (Python) - keep both in sync
// if pricing/menu ever changes until the Python service is fully retired.

export const RESTAURANT_PROFILE = {
  name: 'JING | Halal Hotpot & Grill Buffet',
  shortName: 'JING',
  tagline: 'An elevated Halal Chinese hotpot & grill buffet — a seat for everyone at the table.',
  founderStory:
    "Founded in 2021 by Aishah, JING was created to bring Chinese hotpot culture " +
    "to Singapore's Muslim community with a fully halal-certified, elevated dining experience.",
  address: '11 Tanjong Katong Road, #02-19/20, KINEX Mall, Singapore 437157',
  transitNote: '8-minute walk from Paya Lebar MRT',
  phoneDisplay: '+65 6022 1926',
  hoursDisplay: 'Daily, 12:00pm – 10:00pm (last seating 8:30pm, last order 9:30pm)',
  seatingCapacity: 90,
  halalStatement:
    "Singapore's first and only elevated Halal Chinese Hotpot & Grill Buffet — " +
    'fully halal-certified ingredients throughout, Muslim-owned.',
  diningFormat:
    'Individual mini induction hotpots (up to 4 per table) paired with a shared central grill, ' +
    'so every guest cooks at their own pace without competing for one communal pot.',
  buffetDurationMinutes: 90,
  cuisineDescription:
    'Halal Sichuan-style Chinese hotpot paired with a Korean/Chinese-style BBQ grill in one buffet. ' +
    'Guests build their own broth (mala, Tom Yum, or three milder options), cook shabu-shabu beef, ' +
    'marinated satay, tiger prawns, and fresh seafood at their own individual pot, then grill extras ' +
    'like Sarawak black pepper beef on the shared grill. Premium add-ons include Australian Wagyu, ' +
    'snow crab legs, and lamb rack for guests who want to go beyond the standard buffet.',
};

export const SESSIONS = {
  lunch: { label: 'Lunch', start: '12:00', lastSeating: '15:00', end: '16:00' },
  dinner: { label: 'Dinner', start: '16:00', lastSeating: '20:30', end: '22:00' },
};

export const PRICING = {
  weekdayLunch: 41.9,
  weekdayDinner: 47.9,
  weekendAllDay: 47.9,
  brothRefill: 5.0,
  premiumPlatter: {
    name: 'JING Angus & Wagyu Platter',
    price: 60.0,
    description: 'Australian Angus beef and Wagyu MB4/5, table-side add-on.',
  },
  currency: 'SGD',
};

export const SOUP_BASES = [
  { name: 'Signature Mala', description: 'House-made Sichuan mala broth, spice level customizable.', spiceCustomizable: true },
  { name: 'Tom Yum', description: 'Fragrant, tangy Tom Yum broth, spice level customizable.', spiceCustomizable: true },
  { name: 'Savoury Tomato', description: 'Slow-simmered tomato broth, mild and family-friendly.', spiceCustomizable: false },
  { name: 'Herbal Mushroom', description: 'Earthy herbal mushroom broth.', spiceCustomizable: false },
  { name: 'Creamy Herbal Chicken', description: 'Rich, creamy herbal chicken broth.', spiceCustomizable: false },
];

export const PROTEINS_AND_SPECIALTIES = [
  { name: 'Sarawak Black Pepper Beef', category: 'marinated meat' },
  { name: 'Mutton Satay', category: 'marinated meat' },
  { name: 'Goji Berry Chicken', category: 'marinated meat' },
  { name: 'Tiger Prawns', category: 'seafood' },
  { name: 'Freshwater Patin Fish', category: 'seafood' },
  { name: 'Asari Clams', category: 'seafood' },
  { name: 'Shabu-Shabu Beef', category: 'meat', description: 'Thinly sliced, buffet staple.' },
];

export const A_LA_CARTE_ADD_ONS = [
  { name: 'Snow Crab Legs', price: 22.0 },
  { name: 'Australian Wagyu MB4/5', price: 22.0 },
  { name: 'Lamb Rack', price: 16.0 },
];

export const ROTATING_SIDES_NOTE =
  'Rotating sides such as dumplings and mala noodles are available for dinner Mon–Thu, ' +
  'and all day Friday–Sunday.';

export const FAQ_SNIPPETS = {
  halal: RESTAURANT_PROFILE.halalStatement,
  sauceStation: 'A full DIY sauce station is included in the buffet so every guest can build their own dip.',
  refills: 'Chicken, beef, and vegan mushroom stock top-ups are complimentary; a full broth swap/refill is SGD 5++.',
  duration: 'Buffet seatings run 90 minutes per table.',
  ambience: 'Warm, moody interior with pendant lighting and marble tables, seating about 90 guests.',
  payment: 'Cash and all major credit/debit cards are accepted — American Express is not accepted.',
  parking:
    'Primary option is KINEX Mall Car Park at 11 Tanjong Katong Road (the mall JING is in). ' +
    'Public street parking is also available along Tanjong Katong Road. ' +
    "Payment is via Singapore's Electronic Parking System (EPS) — a cash card or CEPAS card must be " +
    "slotted into the vehicle's In-Vehicle Unit (IU).",
  groupBookings:
    "Group bookings and private events aren't handled by the AI directly — pass these to staff. " +
    'On a call, transfer to staff. On WhatsApp, notify staff with the guest\'s contact and request.',
};

export function socialLinks() {
  return {
    website: 'https://by-jing.com/',
    instagram: 'https://www.instagram.com/jing.singapore/?hl=en',
    facebook: 'https://www.facebook.com/jinghotpot/',
    linkedin: 'https://www.linkedin.com/company/by-jing/',
    opentable: 'https://www.opentable.sg/r/jing-singapore?ref=18648',
    googleReviewFallback: 'https://share.google/LgpROusbO4DSWAO1W',
  };
}

export function sessionForTime(timeStr: string): 'lunch' | 'dinner' {
  const parts = (timeStr ?? '').split(':');
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 'dinner';
  const minutes = hour * 60 + minute;
  return minutes < 16 * 60 ? 'lunch' : 'dinner';
}

// Per-person buffet price for a given ISO date and session.
export function priceFor(dateIso: string, session: 'lunch' | 'dinner'): number {
  let weekday = 0;
  const parsed = new Date(`${dateIso}T00:00:00Z`);
  if (!Number.isNaN(parsed.getTime())) {
    weekday = (parsed.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6, matching Python's date.weekday()
  }
  const isWeekendWindow = weekday === 4 || weekday === 5 || weekday === 6; // Fri, Sat, Sun
  if (isWeekendWindow) return PRICING.weekendAllDay;
  return session === 'lunch' ? PRICING.weekdayLunch : PRICING.weekdayDinner;
}

export function menuSummary() {
  return {
    profile: RESTAURANT_PROFILE,
    sessions: SESSIONS,
    pricing: PRICING,
    soup_bases: SOUP_BASES,
    proteins: PROTEINS_AND_SPECIALTIES,
    a_la_carte_add_ons: A_LA_CARTE_ADD_ONS,
    rotating_sides_note: ROTATING_SIDES_NOTE,
    faq: FAQ_SNIPPETS,
    social: socialLinks(),
  };
}

// Compact knowledge block for voice calls - same facts as knowledgePromptBlock, ~40%
// fewer tokens. Every API call in a live call resends this, so size directly affects
// how many turns fit under the LLM provider's per-minute token limit before a call
// gets rate-limited.
export function voicePromptBlock(): string {
  const soupNames = SOUP_BASES
    .map((s) => `${s.name}${s.spiceCustomizable ? ' (spice-adjustable)' : ''}`)
    .join(', ');
  const proteinNames = PROTEINS_AND_SPECIALTIES.map((p) => p.name).join(', ');
  const addonNames = A_LA_CARTE_ADD_ONS.map((a) => `${a.name} $${a.price.toFixed(0)}`).join(', ');

  return `
JING FACTS (never invent pricing/menu — use only this):
${RESTAURANT_PROFILE.name}. ${RESTAURANT_PROFILE.halalStatement}
${RESTAURANT_PROFILE.address} (${RESTAURANT_PROFILE.transitNote}). ${RESTAURANT_PROFILE.phoneDisplay}
Hours: ${RESTAURANT_PROFILE.hoursDisplay}. ${RESTAURANT_PROFILE.buffetDurationMinutes}-min seatings.
Sessions: Lunch until ${SESSIONS.lunch.lastSeating}, Dinner until ${SESSIONS.dinner.lastSeating}.
Price/pax++: weekday lunch S$${PRICING.weekdayLunch.toFixed(2)}, weekday dinner S$${PRICING.weekdayDinner.toFixed(2)}, Fri-Sun S$${PRICING.weekendAllDay.toFixed(2)} (both sessions). Broth refill S$${PRICING.brothRefill.toFixed(2)}.
Soup bases: ${soupNames}.
Proteins: ${proteinNames}.
Premium: ${PRICING.premiumPlatter.name} S$${PRICING.premiumPlatter.price.toFixed(0)}. A la carte: ${addonNames}.
DIY sauce station included; stock top-ups free.
Payment: ${FAQ_SNIPPETS.payment}
Parking: ${FAQ_SNIPPETS.parking}
${FAQ_SNIPPETS.groupBookings}
Never read a URL aloud — use send_link (review/menu/instagram/facebook/opentable) instead.
`.trim();
}

// Compact plain-text knowledge block injected into the WhatsApp AI system prompt.
export function knowledgePromptBlock(): string {
  const soupLines = SOUP_BASES.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const proteinLines = PROTEINS_AND_SPECIALTIES.map((p) => p.name).join(', ');
  const addonLines = A_LA_CARTE_ADD_ONS.map((a) => `${a.name} (S$${a.price.toFixed(2)})`).join(', ');
  const links = socialLinks();

  return `
RESTAURANT FACTS (use these, never invent pricing or menu details):
Name: ${RESTAURANT_PROFILE.name}
Tagline: ${RESTAURANT_PROFILE.tagline}
Cuisine: ${RESTAURANT_PROFILE.cuisineDescription}
Address: ${RESTAURANT_PROFILE.address} (${RESTAURANT_PROFILE.transitNote})
Phone: ${RESTAURANT_PROFILE.phoneDisplay}
Hours: ${RESTAURANT_PROFILE.hoursDisplay}
Halal: ${RESTAURANT_PROFILE.halalStatement}
Dining format: ${RESTAURANT_PROFILE.diningFormat}
Buffet duration: ${RESTAURANT_PROFILE.buffetDurationMinutes} minutes per seating
Sessions: Lunch ${SESSIONS.lunch.start}-${SESSIONS.lunch.lastSeating} (last seating), Dinner ${SESSIONS.dinner.start}-${SESSIONS.dinner.lastSeating} (last seating)
Pricing (SGD, per person, ++): Weekday lunch ${PRICING.weekdayLunch}, weekday dinner ${PRICING.weekdayDinner}, Fri-Sun all day ${PRICING.weekendAllDay}. Broth refill ${PRICING.brothRefill}.
Premium add-on: ${PRICING.premiumPlatter.name} — S$${PRICING.premiumPlatter.price.toFixed(2)} (${PRICING.premiumPlatter.description})
Soup bases:
${soupLines}
Featured proteins & seafood: ${proteinLines}
A la carte add-ons: ${addonLines}
${ROTATING_SIDES_NOTE}
${FAQ_SNIPPETS.sauceStation} ${FAQ_SNIPPETS.refills}
Social & review links: Instagram ${links.instagram}, Facebook ${links.facebook}, website ${links.website}, OpenTable ${links.opentable}.
Do not read long URLs aloud on a phone call — offer to send them via WhatsApp using the send_link tool instead.
Payment: ${FAQ_SNIPPETS.payment}
Parking: ${FAQ_SNIPPETS.parking}
Group bookings & private events: ${FAQ_SNIPPETS.groupBookings}
`.trim();
}
