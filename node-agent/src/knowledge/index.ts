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

// Added from voice_agent_inbound/knowledge_base.txt - facts likely to come up often
// enough to justify the extra tokens on every turn (corporate buyout, deposits,
// payment, accurate seat count). Detailed FAQ/menu items from the same source live
// in FAQ_TOPICS below instead, retrieved on demand via the answer_faq tool, since
// dumping the whole doc into voicePromptBlock would resend it every single turn of
// a live call and worsen the LLM rate-limiting already seen in testing.
export const SEATING_INFO = {
  nominalSeats: 98,
  effectiveSeats: 94,
  note: 'Table 3 (4-pax) is temporarily out of service, expected fixed within the coming month.',
  lastSeating: 'Lunch 5:00 PM, Dinner & Weekend 7:30 PM, last entry 8:30 PM.',
};

export const CORPORATE_BUYOUT = {
  weekdayLunch2hr: 4500,
  weekdayDinner2hr: 5500,
  weekendEvePh2hr: 6500,
  extraHourLunch: 1500,
  extraHourDinnerWeekend: 1800,
  maxBuyoutPax: 96,
  foodAddOnPrice: 2500,
  foodAddOnDescription: 'Seafood Platter (WA Rock Lobster & Snow Crab Legs) or Meat Platter (Lamb Rack & Australian Wagyu MB4/5)',
  drinksUpgradePrice: 500,
  drinksUpgradeDescription: 'Free-flow Milaf Cola plus Saicho Sparkling Tea, or free-flow Milaf Cola plus NON non-alcoholic bottles',
};

export const BOOKING_REQUIREMENTS = {
  depositPolicy: 'Groups of 12 pax and above require a 50% deposit to confirm the reservation.',
  proofOfPayment: 'A screenshot or transaction confirmation should be sent to bookings@by-jing.com upon payment.',
  softBooking: 'A soft, unconfirmed hold is available on request while a client finalises arrangements.',
};

export const PAYMENT_INFO = {
  payNowUen: '202324872H',
  creditCardLink: 'https://securecheckout.hit-pay.com/payment-request/@jinshangyipin-hotpot-pte-ltd',
  govProcurement: 'Registered on Vendors@Gov / GeBIZ - government agencies may raise a PO.',
  bookingsEmail: 'bookings@by-jing.com',
};

// Long-tail Q&A + detailed menus from voice_agent_inbound/knowledge_base.txt, looked
// up on demand via the answer_faq voice tool rather than always loaded into the prompt.
export const FAQ_TOPICS: Array<{ keywords: string[]; answer: string }> = [
  {
    keywords: ['allerg'],
    answer:
      'We take allergens seriously and do our best to accommodate all requirements where possible, but we ' +
      'cannot guarantee a completely allergy-free meal, including gluten, since we do not have a separate kitchen.',
  },
  {
    keywords: ['dietary', 'special diet'],
    answer:
      'We can accommodate most dietary requirements - just add a note to the booking and let the team know ' +
      'when ordering. If they are concerned, offer to transfer them to a colleague.',
  },
  {
    keywords: ['vegan'],
    answer: 'We have vegan options on the menu - add a note to the booking and let the team know when ordering.',
  },
  {
    keywords: ['vegetarian'],
    answer: 'We have vegetarian options on the menu.',
  },
  {
    keywords: ['gluten'],
    answer:
      'We offer many gluten-free options on the menu - please add a note to the booking and let the team know ' +
      'when ordering.',
  },
  {
    keywords: ['halal'],
    answer: 'Yes, JING is an exclusively halal venue, fully halal-certified.',
  },
  {
    keywords: ['parking', 'park'],
    answer: 'Parking is available in the KINEX Mall car park.',
  },
  {
    keywords: ['byo', 'alcohol', 'wine', 'licensed'],
    answer: 'JING is a halal establishment, so alcohol is not allowed and BYO is not permitted.',
  },
  {
    keywords: ['cake', 'birthday', 'celebrat', 'decoration'],
    answer:
      'Celebrations are welcome - guests may bring a cake as long as it is halal-certified, and we provide a ' +
      'small complimentary cake for birthdays. Decorations are welcome but kept to a minimum - no confetti or ' +
      'table scatters.',
  },
  {
    keywords: ['pet', 'dog'],
    answer:
      "Unfortunately there isn't space for pets, but service dogs are allowed anywhere in the venue.",
  },
  {
    keywords: ['seating request', 'particular section', 'specific table', 'sit near'],
    answer: "Add a note to the booking and we'll do our best to honour a seating request, though it can't be guaranteed.",
  },
  {
    keywords: ['public holiday', 'holiday hours', 'ramadan'],
    answer:
      'JING is open on all public holidays except the first day of Ramadan - standard rates apply. ' +
      'Suggest checking social pages or Google for specific details if unsure.',
  },
  {
    keywords: ['child', 'kid', 'baby', 'high chair', 'babychair'],
    answer: 'JING is child-friendly and offers baby chairs.',
  },
  {
    keywords: ['wheelchair', 'disabled', 'accessib'],
    answer: 'Yes, the venue is wheelchair accessible.',
  },
  {
    keywords: ['buyout', 'corporate event', 'full restaurant', 'exclusive use', 'private event'],
    answer:
      `Full-restaurant buyout (2 hours): weekday lunch S$${CORPORATE_BUYOUT.weekdayLunch2hr}++, weekday dinner ` +
      `S$${CORPORATE_BUYOUT.weekdayDinner2hr}++, weekend/eve-PH S$${CORPORATE_BUYOUT.weekendEvePh2hr}++. Extra hour: ` +
      `S$${CORPORATE_BUYOUT.extraHourLunch}++ (lunch) or S$${CORPORATE_BUYOUT.extraHourDinnerWeekend}++ (dinner/weekend). ` +
      `Max buyout capacity ${CORPORATE_BUYOUT.maxBuyoutPax} pax. Premium food add-on S$${CORPORATE_BUYOUT.foodAddOnPrice}++ ` +
      `(${CORPORATE_BUYOUT.foodAddOnDescription}); premium drinks upgrade S$${CORPORATE_BUYOUT.drinksUpgradePrice}++ ` +
      `(${CORPORATE_BUYOUT.drinksUpgradeDescription}). For groups of 12+, a 50% deposit is required to confirm. ` +
      'This should be passed to staff to finalise - offer to transfer or take their details.',
  },
  {
    keywords: ['drinks menu', 'drink list', 'what drinks', 'beverages', 'cocktail', 'mocktail'],
    answer:
      'Drinks are a la carte add-ons: housemade mocktails (Velvet Dusk, Amber Bloom, Spice Drift), Salaam Cola ' +
      '(Original, No Sugar, or Yemonade), 750ml bottles (Toasted Cinnamon & Yuzu, Lemon Marmalade & Hibiscus, ' +
      'Oaked Blackberry & Plum), Saicho sparkling tea (Houjicha, Jasmine, Darjeeling), and San Pellegrino or ' +
      'Acqua Panna water. Offer to send the full menu via WhatsApp using send_link rather than reading it all out.',
  },
  {
    keywords: ['food menu', 'what food', 'menu items', 'what meat', 'proteins available'],
    answer:
      'Beyond the standard soup bases and proteins, the buffet includes marinated house specialties (Goji Berry ' +
      'Chicken, Sarawak Black Pepper Chicken and Beef, Chicken and Mutton Satay), curated selections (Lemongrass ' +
      'Chicken, Mala Spiced Chicken/Beef, Cumin Spiced Mutton), and shabu-shabu classics (US Beef Short Plate, NZ ' +
      'Beef Striploin, Thin Sliced Chicken). Premium a la carte meats (Lamb Rack, Australian Angus/Wagyu, Rock ' +
      'Lobster, Snow Crab, JING platters) are available at extra cost. Offer to send the full menu via WhatsApp ' +
      'using send_link rather than reading it all out.',
  },
  {
    keywords: ['payment method', 'how to pay', 'paynow', 'credit card', 'gebiz', 'vendors@gov', 'purchase order'],
    answer:
      `PayNow UEN ${PAYMENT_INFO.payNowUen}, or credit card via ${PAYMENT_INFO.creditCardLink}. ` +
      `${PAYMENT_INFO.govProcurement} Proof of payment should be sent to ${PAYMENT_INFO.bookingsEmail}.`,
  },
];

export function lookupFaq(topic: string): string | null {
  const lowered = (topic ?? '').toLowerCase();
  const match = FAQ_TOPICS.find((t) => t.keywords.some((k) => lowered.includes(k)));
  return match?.answer ?? null;
}

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
Seating: ${SEATING_INFO.effectiveSeats} effective seats. Last seating: ${SEATING_INFO.lastSeating}
Groups of 12+ pax: ${BOOKING_REQUIREMENTS.depositPolicy} Bookings email: ${PAYMENT_INFO.bookingsEmail}
Full-restaurant corporate buyout available (from S$${CORPORATE_BUYOUT.weekdayLunch2hr}++/2hrs) - use answer_faq for exact pricing/add-ons if asked.
For allergies, dietary needs, drinks/food menu detail, pets, celebrations, holiday hours, or other questions not covered above, call answer_faq instead of guessing.
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
