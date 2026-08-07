"""Static business knowledge for JING | Halal Hotpot & Grill Buffet.

Sourced from by-jing.com, the KINEX Mall directory listing, muslimownedsg.com,
and eatbook.sg (August 2026). Kept as data (not hardcoded prose) so the AI
concierge, the WhatsApp agent, and the dashboard menu view all read from the
same source of truth. Update this file when pricing or the menu changes.
"""

from __future__ import annotations

RESTAURANT_PROFILE = {
    "name": "JING | Halal Hotpot & Grill Buffet",
    "short_name": "JING",
    "tagline": "An elevated Halal Chinese hotpot & grill buffet — a seat for everyone at the table.",
    "founder_story": (
        "Founded in 2021 by Aishah, JING was created to bring Chinese hotpot culture "
        "to Singapore's Muslim community with a fully halal-certified, elevated dining experience."
    ),
    "address": "11 Tanjong Katong Road, #02-19/20, KINEX Mall, Singapore 437157",
    "transit_note": "8-minute walk from Paya Lebar MRT",
    "phone_display": "+65 6022 1926",
    "hours_display": "Daily, 12:00pm – 10:00pm (last seating 8:30pm, last order 9:30pm)",
    "seating_capacity": 90,
    "halal_statement": (
        "Singapore's first and only elevated Halal Chinese Hotpot & Grill Buffet — "
        "fully halal-certified ingredients throughout, Muslim-owned."
    ),
    "dining_format": (
        "Individual mini induction hotpots (up to 4 per table) paired with a shared central grill, "
        "so every guest cooks at their own pace without competing for one communal pot."
    ),
    "buffet_duration_minutes": 90,
    "cuisine_description": (
        "Halal Sichuan-style Chinese hotpot paired with a Korean/Chinese-style BBQ grill in one buffet. "
        "Guests build their own broth (mala, Tom Yum, or three milder options), cook shabu-shabu beef, "
        "marinated satay, tiger prawns, and fresh seafood at their own individual pot, then grill extras "
        "like Sarawak black pepper beef on the shared grill. Premium add-ons include Australian Wagyu, "
        "snow crab legs, and lamb rack for guests who want to go beyond the standard buffet."
    ),
}

SESSIONS = {
    "lunch": {"label": "Lunch", "start": "12:00", "last_seating": "15:00", "end": "16:00"},
    "dinner": {"label": "Dinner", "start": "16:00", "last_seating": "20:30", "end": "22:00"},
}

# Per-person buffet pricing in SGD. Friday–Sunday runs a single all-day rate.
PRICING = {
    "weekday_lunch": 41.90,
    "weekday_dinner": 47.90,
    "weekend_all_day": 47.90,
    "broth_refill": 5.00,
    "premium_platter": {
        "name": "JING Angus & Wagyu Platter",
        "price": 60.00,
        "description": "Australian Angus beef and Wagyu MB4/5, table-side add-on.",
    },
    "currency": "SGD",
}

SOUP_BASES = [
    {"name": "Signature Mala", "description": "House-made Sichuan mala broth, spice level customizable.", "spice_customizable": True},
    {"name": "Tom Yum", "description": "Fragrant, tangy Tom Yum broth, spice level customizable.", "spice_customizable": True},
    {"name": "Savoury Tomato", "description": "Slow-simmered tomato broth, mild and family-friendly.", "spice_customizable": False},
    {"name": "Herbal Mushroom", "description": "Earthy herbal mushroom broth.", "spice_customizable": False},
    {"name": "Creamy Herbal Chicken", "description": "Rich, creamy herbal chicken broth.", "spice_customizable": False},
]

PROTEINS_AND_SPECIALTIES = [
    {"name": "Sarawak Black Pepper Beef", "category": "marinated meat"},
    {"name": "Mutton Satay", "category": "marinated meat"},
    {"name": "Goji Berry Chicken", "category": "marinated meat"},
    {"name": "Tiger Prawns", "category": "seafood"},
    {"name": "Freshwater Patin Fish", "category": "seafood"},
    {"name": "Asari Clams", "category": "seafood"},
    {"name": "Shabu-Shabu Beef", "category": "meat", "description": "Thinly sliced, buffet staple."},
]

A_LA_CARTE_ADD_ONS = [
    {"name": "Snow Crab Legs", "price": 22.00},
    {"name": "Australian Wagyu MB4/5", "price": 22.00},
    {"name": "Lamb Rack", "price": 16.00},
]

ROTATING_SIDES_NOTE = (
    "Rotating sides such as dumplings and mala noodles are available for dinner Mon–Thu, "
    "and all day Friday–Sunday."
)

FAQ_SNIPPETS = {
    "halal": RESTAURANT_PROFILE["halal_statement"],
    "sauce_station": "A full DIY sauce station is included in the buffet so every guest can build their own dip.",
    "refills": "Chicken, beef, and vegan mushroom stock top-ups are complimentary; a full broth swap/refill is SGD 5++.",
    "duration": "Buffet seatings run 90 minutes per table.",
    "ambience": "Warm, moody interior with pendant lighting and marble tables, seating about 90 guests.",
    "payment": "Cash and all major credit/debit cards are accepted — American Express is not accepted.",
    "parking": (
        "Primary option is KINEX Mall Car Park at 11 Tanjong Katong Road (the mall JING is in). "
        "Public street parking is also available along Tanjong Katong Road. "
        "Payment is via Singapore's Electronic Parking System (EPS) — a cash card or CEPAS card must be "
        "slotted into the vehicle's In-Vehicle Unit (IU)."
    ),
    "group_bookings": (
        "Group bookings and private events aren't handled by the AI directly — pass these to staff. "
        "On a call, transfer to staff. On WhatsApp, notify staff with the guest's contact and request."
    ),
}


def social_links() -> dict:
    return {
        "website": "https://by-jing.com/",
        "instagram": "https://www.instagram.com/jing.singapore/?hl=en",
        "facebook": "https://www.facebook.com/jinghotpot/",
        "linkedin": "https://www.linkedin.com/company/by-jing/",
        "opentable": "https://www.opentable.sg/r/jing-singapore?ref=18648",
        "google_review_fallback": "https://share.google/LgpROusbO4DSWAO1W",
    }


def session_for_time(time_str: str) -> str:
    """Return 'lunch' or 'dinner' for an HH:MM time string."""
    try:
        hour, minute = (int(part) for part in time_str.split(":", 1))
    except (ValueError, AttributeError):
        return "dinner"
    minutes = hour * 60 + minute
    lunch_end = 16 * 60
    return "lunch" if minutes < lunch_end else "dinner"


def price_for(date_iso: str, session: str) -> float:
    """Per-person buffet price for a given ISO date and session."""
    from datetime import date as date_cls

    try:
        weekday = date_cls.fromisoformat(date_iso).weekday()  # Mon=0 ... Sun=6
    except ValueError:
        weekday = 0
    is_weekend_window = weekday in (4, 5, 6)  # Fri, Sat, Sun
    if is_weekend_window:
        return PRICING["weekend_all_day"]
    return PRICING["weekday_lunch"] if session == "lunch" else PRICING["weekday_dinner"]


def menu_summary() -> dict:
    return {
        "profile": RESTAURANT_PROFILE,
        "sessions": SESSIONS,
        "pricing": PRICING,
        "soup_bases": SOUP_BASES,
        "proteins": PROTEINS_AND_SPECIALTIES,
        "a_la_carte_add_ons": A_LA_CARTE_ADD_ONS,
        "rotating_sides_note": ROTATING_SIDES_NOTE,
        "faq": FAQ_SNIPPETS,
        "social": social_links(),
    }


def voice_prompt_block() -> str:
    """Compact knowledge block for voice calls — same facts as knowledge_prompt_block, ~40%
    fewer tokens. Every API call in a live call resends this, so size directly affects how
    many turns fit under Groq's per-minute token limit before a call gets rate-limited.
    """
    soup_names = ", ".join(f"{s['name']}{' (spice-adjustable)' if s['spice_customizable'] else ''}" for s in SOUP_BASES)
    protein_names = ", ".join(p["name"] for p in PROTEINS_AND_SPECIALTIES)
    addon_names = ", ".join(f"{a['name']} ${a['price']:.0f}" for a in A_LA_CARTE_ADD_ONS)
    links = social_links()
    return f"""
JING FACTS (never invent pricing/menu — use only this):
{RESTAURANT_PROFILE['name']}. {RESTAURANT_PROFILE['halal_statement']}
{RESTAURANT_PROFILE['address']} ({RESTAURANT_PROFILE['transit_note']}). {RESTAURANT_PROFILE['phone_display']}
Hours: {RESTAURANT_PROFILE['hours_display']}. {RESTAURANT_PROFILE['buffet_duration_minutes']}-min seatings.
Sessions: Lunch until {SESSIONS['lunch']['last_seating']}, Dinner until {SESSIONS['dinner']['last_seating']}.
Price/pax++: weekday lunch S${PRICING['weekday_lunch']:.2f}, weekday dinner S${PRICING['weekday_dinner']:.2f}, Fri-Sun S${PRICING['weekend_all_day']:.2f} (both sessions). Broth refill S${PRICING['broth_refill']:.2f}.
Soup bases: {soup_names}.
Proteins: {protein_names}.
Premium: {PRICING['premium_platter']['name']} S${PRICING['premium_platter']['price']:.0f}. A la carte: {addon_names}.
DIY sauce station included; stock top-ups free.
Payment: {FAQ_SNIPPETS['payment']}
Parking: {FAQ_SNIPPETS['parking']}
{FAQ_SNIPPETS['group_bookings']}
Never read a URL aloud — use send_link (review/menu/instagram/facebook/opentable) instead.
""".strip()


def knowledge_prompt_block() -> str:
    """Compact plain-text knowledge block injected into the AI system prompt."""
    soup_lines = "\n".join(f"- {s['name']}: {s['description']}" for s in SOUP_BASES)
    protein_lines = ", ".join(p["name"] for p in PROTEINS_AND_SPECIALTIES)
    addon_lines = ", ".join(f"{a['name']} (S${a['price']:.2f})" for a in A_LA_CARTE_ADD_ONS)
    links = social_links()
    return f"""
RESTAURANT FACTS (use these, never invent pricing or menu details):
Name: {RESTAURANT_PROFILE['name']}
Tagline: {RESTAURANT_PROFILE['tagline']}
Cuisine: {RESTAURANT_PROFILE['cuisine_description']}
Address: {RESTAURANT_PROFILE['address']} ({RESTAURANT_PROFILE['transit_note']})
Phone: {RESTAURANT_PROFILE['phone_display']}
Hours: {RESTAURANT_PROFILE['hours_display']}
Halal: {RESTAURANT_PROFILE['halal_statement']}
Dining format: {RESTAURANT_PROFILE['dining_format']}
Buffet duration: {RESTAURANT_PROFILE['buffet_duration_minutes']} minutes per seating
Sessions: Lunch {SESSIONS['lunch']['start']}-{SESSIONS['lunch']['last_seating']} (last seating), Dinner {SESSIONS['dinner']['start']}-{SESSIONS['dinner']['last_seating']} (last seating)
Pricing (SGD, per person, ++): Weekday lunch {PRICING['weekday_lunch']}, weekday dinner {PRICING['weekday_dinner']}, Fri-Sun all day {PRICING['weekend_all_day']}. Broth refill {PRICING['broth_refill']}.
Premium add-on: {PRICING['premium_platter']['name']} — S${PRICING['premium_platter']['price']:.2f} ({PRICING['premium_platter']['description']})
Soup bases:
{soup_lines}
Featured proteins & seafood: {protein_lines}
A la carte add-ons: {addon_lines}
{ROTATING_SIDES_NOTE}
{FAQ_SNIPPETS['sauce_station']} {FAQ_SNIPPETS['refills']}
Social & review links: Instagram {links['instagram']}, Facebook {links['facebook']}, website {links['website']}, OpenTable {links['opentable']}.
Do not read long URLs aloud on a phone call — offer to send them via WhatsApp using the send_link tool instead.
Payment: {FAQ_SNIPPETS['payment']}
Parking: {FAQ_SNIPPETS['parking']}
Group bookings & private events: {FAQ_SNIPPETS['group_bookings']}
""".strip()
