# JING | Halal Hotpot & Grill Buffet — AI Operations

A real-world restaurant AI operations project for **JING | Halal Hotpot & Grill Buffet** (KINEX Mall, Singapore), with a FastAPI backend, an AI concierge, and a live ops dashboard.

## What it shows
- WhatsApp booking intake handled by an LLM (Groq) tool-calling concierge — grounded in JING's real menu, soup bases, halal certification, hours, and pricing, with a rule-based fallback if no API key is configured
- WhatsApp voice-note booking intake via Deepgram
- **Live phone agent (beta)** — answers and makes real calls over Twilio Media Streams, using Deepgram Nova-3 (speech-to-text, keyterm-boosted for halal/menu vocabulary) and Aura-2 (speech), with the same tool-calling agent as WhatsApp plus a `transfer_to_staff` tool that hands the call to a real staff line via Twilio's own call-redirect (not a homegrown bridge, to avoid lag/drops on transfer). See [Phone voice agent](#phone-voice-agent) below.
- Buffet session (lunch/dinner) and 90-seat capacity tracking, with automatic waitlisting when a session is full
- Automatic reminder scheduling (24h / 2h)
- Post-visit review requests
- AI-drafted Google review replies
- Loyalty points, tiers (Bronze/Silver/Gold), and voucher issuance
- A Menu & Buffet dashboard view showing live pricing, soup bases, and add-ons (same data the AI concierge uses)

## Phone voice agent
Requires three things not needed for WhatsApp, all set in `.env`:
- `TWILIO_VOICE_NUMBER` — a Twilio number with Voice capability (the WhatsApp sandbox number won't work for this)
- `STAFF_TRANSFER_NUMBER` — the direct line calls get transferred to
- `PUBLIC_BASE_URL` — a public HTTPS URL Twilio can reach (a `cloudflared` tunnel for local dev, or your production domain)

Once set, point your Twilio Voice number's webhook at `{PUBLIC_BASE_URL}/webhook/voice`. The dashboard's Voice view shows a live readiness checklist and lets you trigger outbound calls.

**Before relying on this for real customers:** the STT model has not been validated against real Singlish/Singaporean-accented speech — only against synthesized test audio, which is not a reliable proxy for accent handling. Record a handful of real sample calls and check the transcripts in the dashboard's message log before going live.

## How to run
1. Copy [.env.example](.env.example) to `.env` and fill in your real values (Twilio, Groq, Deepgram, Google Place ID).
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the backend with [`run-backend.bat`](run-backend.bat) or `uvicorn restaurant_agent.app:app --reload --port 8000`.
4. Open `http://127.0.0.1:8000` in Chrome and log in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` from `.env`.

## Security
- **Dashboard login**: the whole dashboard and every `/api/*` route require HTTP Basic Auth (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` in `.env`). If unset, the server refuses all non-webhook traffic rather than running open — change the auto-generated password in `.env` before sharing the URL with anyone.
- **Twilio webhooks** (`/webhook/whatsapp`, `/webhook/voice`, `/webhook/voice-outbound`) can't use a login (Twilio calls them directly), so instead every request's `X-Twilio-Signature` is verified against `TWILIO_AUTH_TOKEN` — spoofed requests are rejected with 403. Disable only for local testing via `VERIFY_TWILIO_SIGNATURE=false`.
- **CORS** is restricted to `ALLOWED_ORIGINS` (defaults to localhost + `PUBLIC_BASE_URL`) instead of allowing any website.
- Not yet done: per-staff accounts/roles (currently one shared login), rate limiting on failed logins, and HTTPS itself (terminate TLS at your host/reverse proxy — Basic Auth over plain HTTP sends credentials in the clear).

## Business knowledge
[restaurant_agent/knowledge.py](restaurant_agent/knowledge.py) is the single source of truth for JING's menu, soup bases, pricing tiers, hours, and halal positioning. Both the AI concierge and the dashboard's Menu view read from it — update pricing or the menu there and both stay in sync.

## Deploy
See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker build and webhook setup steps.

## Roadmap / not yet implemented
- Live Google rating (set `GOOGLE_RATING` manually in `.env` for now; wire up the Places API for automatic updates)
- A real Google Place ID for JING (`GOOGLE_PLACE_ID` in `.env` — falls back to the Google share link until set)
- Real-world Singlish accent validation for the phone agent (see [Phone voice agent](#phone-voice-agent) above)
- Real Instagram Graph API DM automation (currently a routing stub)

## Client handoff
The project is structured for real use at JING. If you want, I can next convert the dashboard into a hosted React app, add queue-backed reminder workers, or wire up a real Google Places integration for live ratings.
