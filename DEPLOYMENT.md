# Deployment Guide

This project is ready to deploy as a Docker container.

## Required environment variables
- `GROQ_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_NUMBER`
- `DEEPGRAM_API_KEY`
- `DEEPGRAM_MODEL`
- `RESTAURANT_NAME`
- `RESTAURANT_PHONE`
- `DATABASE_URL`
- `BOOKING_TIMEZONE`
- `GOOGLE_PLACE_ID`
- `GOOGLE_REVIEW_FALLBACK_URL`
- `GOOGLE_RATING`
- `REVIEW_DELAY_HOURS`
- `LOYALTY_THRESHOLD`
- `LOYALTY_REWARD_PCT`
- `SEATING_CAPACITY`
- `BUFFET_DURATION_MINUTES`
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` (required — the server refuses non-webhook traffic without these)
- `VERIFY_TWILIO_SIGNATURE`
- `ALLOWED_ORIGINS`

## HTTPS
Basic Auth sends credentials in the clear over plain HTTP. Terminate TLS at your host/reverse proxy (Azure App Service, a Cloudflare Tunnel, or similar) before exposing this beyond `127.0.0.1`.

## Local build
1. Copy `.env.example` to `.env`.
2. Build the image: `docker build -t restaurant-agent .`
3. Run it: `docker run --env-file .env -p 8000:8000 restaurant-agent`
4. Open `http://127.0.0.1:8000`.

## Webhook setup
Set your Twilio WhatsApp webhook to:
- `https://your-domain.example/webhook/whatsapp`

## Notes
- SQLite is fine for local use, but use PostgreSQL in production if you need multi-instance reliability.
- The dashboard and backend are served from the same host, so same-origin requests work cleanly in production.
- WhatsApp voice notes are transcribed through Deepgram before the booking flow continues.
