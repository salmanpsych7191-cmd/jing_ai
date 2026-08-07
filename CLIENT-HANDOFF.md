# Client Handoff — JING | Halal Hotpot & Grill Buffet

## What this delivers
This workspace includes a custom VS Code agent plus a real-world restaurant AI operations dashboard, configured for JING's halal hotpot & grill buffet (KINEX Mall, Singapore).

## Agent file
- [.github/agents/restaurant-retail-ai-agent.agent.md](.github/agents/restaurant-retail-ai-agent.agent.md)

## What the agent does
- Handles WhatsApp booking intake without human involvement
- Sends booking reminders at 24 hours and 2 hours
- Sends post-visit review requests
- Drafts AI replies to Google reviews
- Tracks loyalty points and issues reward vouchers

## How to use it
1. Open this project in VS Code.
2. Fill in `.env` with real credentials.
3. Run `run-backend.bat` or start `uvicorn restaurant_agent.app:app --reload --port 8000`.
4. Open `http://127.0.0.1:8000` in Chrome.
5. Open the Copilot chat agent picker and select "Restaurant Retail AI Agent" when you want help changing the workflows.

## Notes
- External services such as Twilio, Groq, Airtable, and Google Business Profile must be configured separately.
- If you want voice bookings from WhatsApp notes, add a Deepgram key and model in `.env`.
- API keys and secrets should be added in a local `.env` file and not shared publicly.
- If the client wants a different stack or tone, edit the agent file before delivery.
