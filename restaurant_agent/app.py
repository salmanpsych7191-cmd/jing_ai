from __future__ import annotations

import asyncio
import base64
import json
import os
import queue
import re
import secrets
import time
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras
import websockets
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
from openai import OpenAI
from twilio.rest import Client as TwilioClient
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse
from twilio.twiml.voice_response import VoiceResponse
import httpx

from . import knowledge

load_dotenv()

APP_DIR = Path(__file__).resolve().parent
# Some providers (Neon included, historically) hand out the older "postgres://" scheme;
# psycopg2 accepts either, but SQLAlchemy 2.x (used by the scheduler's job store) requires
# "postgresql://", so normalize once here for both consumers.
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgres://", "postgresql://", 1)
RESTAURANT_NAME = os.getenv("RESTAURANT_NAME", "Your Restaurant")
RESTAURANT_PHONE = os.getenv("RESTAURANT_PHONE", "")
GOOGLE_PLACE_ID = os.getenv("GOOGLE_PLACE_ID", "")
GOOGLE_REVIEW_FALLBACK_URL = os.getenv("GOOGLE_REVIEW_FALLBACK_URL", "")
GOOGLE_RATING = os.getenv("GOOGLE_RATING", "").strip()
REVIEW_DELAY_HOURS = int(os.getenv("REVIEW_DELAY_HOURS", "2"))
LOYALTY_THRESHOLD = int(os.getenv("LOYALTY_THRESHOLD", "500"))
LOYALTY_REWARD_PCT = int(os.getenv("LOYALTY_REWARD_PCT", "20"))
SEATING_CAPACITY = int(os.getenv("SEATING_CAPACITY", str(knowledge.RESTAURANT_PROFILE["seating_capacity"])))
BUFFET_DURATION_MINUTES = int(os.getenv("BUFFET_DURATION_MINUTES", str(knowledge.RESTAURANT_PROFILE["buffet_duration_minutes"])))
# Aura-1 (not the newer Aura-2) per explicit request. Six voices available for
# DEEPGRAM_TTS_MODEL: aura-asteria-en (default, female), aura-luna-en (female),
# aura-stella-en (female), aura-athena-en (female), aura-hera-en (female), aura-orion-en (male).
AURA_VOICES = [
    "aura-asteria-en", "aura-luna-en", "aura-stella-en",
    "aura-athena-en", "aura-hera-en", "aura-orion-en",
]
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")
# Fixed inbound greeting text — pre-synthesized once at server startup (see
# presynthesize_greeting()) so the very first thing a caller hears plays instantly
# instead of waiting on a live TTS round-trip. Outbound greetings are personalized
# per-call (guest name + purpose) so they can't be pre-cached the same way.
INBOUND_GREETING_TEXT = f"Hi there, thanks so much for calling {RESTAURANT_NAME}! What can I help you with today?"
_presynthesized_greeting_audio: Optional[bytes] = None
VOICE_GROQ_MODEL = os.getenv("VOICE_GROQ_MODEL") or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
TWILIO_VOICE_NUMBER = os.getenv("TWILIO_VOICE_NUMBER", "")
STAFF_TRANSFER_NUMBER = os.getenv("STAFF_TRANSFER_NUMBER", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
DASHBOARD_USERNAME = os.getenv("DASHBOARD_USERNAME", "")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
VERIFY_TWILIO_SIGNATURE = os.getenv("VERIFY_TWILIO_SIGNATURE", "true").lower() == "true"
_default_origins = ["http://127.0.0.1:8000", "http://localhost:8000"]
if PUBLIC_BASE_URL:
    _default_origins.append(PUBLIC_BASE_URL)
ALLOWED_ORIGINS = [
    origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", ",".join(_default_origins)).split(",") if origin.strip()
]
TWILIO_WHATSAPP_NUMBER = os.getenv("TWILIO_WHATSAPP_NUMBER", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_SANDBOX_CODE = os.getenv("TWILIO_SANDBOX_CODE", "")
BOOKING_TIMEZONE = os.getenv("BOOKING_TIMEZONE", "UTC")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
DEEPGRAM_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-2")
TWILIO_CONFIRMATION_CONTENT_SID = os.getenv("TWILIO_CONFIRMATION_CONTENT_SID", "")
TWILIO_REMINDER_CONTENT_SID = os.getenv("TWILIO_REMINDER_CONTENT_SID", "")
TWILIO_REVIEW_CONTENT_SID = os.getenv("TWILIO_REVIEW_CONTENT_SID", "")
TWILIO_LOYALTY_CONTENT_SID = os.getenv("TWILIO_LOYALTY_CONTENT_SID", "")
LOCAL_TZ = ZoneInfo(BOOKING_TIMEZONE)

client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
) if GROQ_API_KEY else None

# Voice calls hit Groq's free-tier per-minute token limit mid-conversation (confirmed in
# production logs — real calls dropping turns). VOICE_LLM_PROVIDER switches the voice-only
# LLM to a separate provider (Cerebras, which has its own separate rate-limit pool) without
# touching the WhatsApp agent above. Set VOICE_LLM_PROVIDER=groq (or unset) to roll back
# instantly via env var, no redeploy needed.
VOICE_LLM_PROVIDER = os.getenv("VOICE_LLM_PROVIDER", "groq").lower()
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY", "")
if VOICE_LLM_PROVIDER == "cerebras" and CEREBRAS_API_KEY:
    VOICE_GROQ_MODEL = os.getenv("VOICE_GROQ_MODEL", "gemma-4-31b")
    _voice_api_key = CEREBRAS_API_KEY
    _voice_base_url = "https://api.cerebras.ai/v1"
else:
    _voice_api_key = GROQ_API_KEY
    _voice_base_url = "https://api.groq.com/openai/v1"
# Separate client for live calls: the default client's automatic retry-with-backoff on 429
# waited up to 26s silently on a real call (confirmed in production logs) — dead air that
# long makes a caller hang up. Voice fails fast instead and uses its own short retry so a
# rate limit surfaces as "sorry, one more time?" in a couple seconds, not a dropped call.
voice_client = OpenAI(
    api_key=_voice_api_key,
    base_url=_voice_base_url,
    max_retries=0,
    timeout=8.0,
) if _voice_api_key else None
# Persisted to the same Postgres database so scheduled reminders (24h/2h before a booking)
# survive a process restart instead of silently vanishing from an in-memory job store.
scheduler = BackgroundScheduler(
    timezone=LOCAL_TZ,
    jobstores={"default": SQLAlchemyJobStore(url=DATABASE_URL)},
)
scheduler.start()
LAST_TWILIO_ERROR: Optional[str] = None
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI(title="Restaurant Retail AI Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/") or path == "/" or path == "/index.html":
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


# Paths Twilio calls directly (webhooks, media streaming) can't do an interactive login,
# so they're exempt here and protected separately by Twilio request-signature validation instead.
AUTH_EXEMPT_PREFIXES = ("/webhook/", "/health")


class DashboardAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith(AUTH_EXEMPT_PREFIXES):
            return await call_next(request)

        if not (DASHBOARD_USERNAME and DASHBOARD_PASSWORD):
            return Response(
                content=(
                    "Dashboard login is not configured. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in .env "
                    "before this server can be used."
                ),
                status_code=503,
            )

        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
                username, _, password = decoded.partition(":")
            except Exception:  # noqa: BLE001
                username, password = "", ""
            if secrets.compare_digest(username, DASHBOARD_USERNAME) and secrets.compare_digest(password, DASHBOARD_PASSWORD):
                return await call_next(request)

        return Response(
            content="Authentication required.",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="JING Dashboard"'},
        )


app.add_middleware(DashboardAuthMiddleware)
app.add_middleware(CacheControlMiddleware)
app.mount("/assets", StaticFiles(directory=APP_DIR), name="assets")


async def verify_twilio_request(request: Request) -> None:
    """Reject webhook calls that aren't genuinely from Twilio (spoofed bookings/messages/calls)."""
    if not VERIFY_TWILIO_SIGNATURE or not TWILIO_AUTH_TOKEN:
        return
    signature = request.headers.get("X-Twilio-Signature", "")
    form = await request.form()
    base_url = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    full_url = f"{base_url}{request.url.path}"
    if request.url.query:
        full_url = f"{full_url}?{request.url.query}"
    validator = RequestValidator(TWILIO_AUTH_TOKEN)
    if not validator.validate(full_url, dict(form), signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


class BookingCreate(BaseModel):
    guest_name: str
    phone: str
    date: str
    time: str
    guests: int = Field(gt=0)
    special_requests: str = ""


class VisitCompleteRequest(BaseModel):
    booking_id: str
    bill_amount: float = Field(gt=0)


class ReviewDraftRequest(BaseModel):
    reviewer_name: str
    review_text: str
    rating: int = Field(ge=1, le=5)
    save: bool = False
    phone: str = ""


class ReviewRecordCreate(BaseModel):
    reviewer_name: str
    phone: str = ""
    review_text: str
    rating: int = Field(ge=1, le=5)
    source: str = "Dashboard"


class VisitRequest(BaseModel):
    booking_id: str
    guest_phone: str
    guest_name: str
    bill_amount: float = Field(gt=0)


class ReviewRequestPayload(BaseModel):
    reviewer_name: str
    review_text: str
    rating: int = Field(ge=1, le=5)


class ReviewRequestRequest(BaseModel):
    phone: str
    guest_name: str
    platform: str = "Google Maps"


class RetailReminderRequest(BaseModel):
    phone: str
    guest_name: str
    last_item: str
    next_reorder: str = "This week"


class InstagramDMRequest(BaseModel):
    phone: str
    message: str
    guest_name: str = "Guest"


class LoyaltyUpdateRequest(BaseModel):
    phone: str
    guest_name: str
    bill_amount: float = Field(gt=0)


class VoiceBookingTestRequest(BaseModel):
    phone: str
    transcript: str


class TwilioTestRequest(BaseModel):
    phone: str
    body: str = "Test message from Restaurant Retail AI Agent"


class ChatMessageRequest(BaseModel):
    phone: str
    message: str


class ChatResetRequest(BaseModel):
    phone: str


class WhatsAppBookingSession(BaseModel):
    phone: str
    stage: str
    guest_name: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    guests: Optional[int] = None
    special_requests: Optional[str] = None


class CapacityExceededError(Exception):
    def __init__(self, date: str, session: str, seats_remaining: int, requested: int):
        self.date = date
        self.session = session
        self.seats_remaining = seats_remaining
        self.requested = requested
        super().__init__(
            f"Requested {requested} seats for {date} {session}, only {seats_remaining} remaining"
        )


class WaitlistCreate(BaseModel):
    guest_name: str
    phone: str
    date: str
    session: str
    guests: int = Field(gt=0)
    notes: str = ""


class TableCreate(BaseModel):
    name: str
    capacity: int = Field(gt=0)
    section: str = ""


class TableUpdate(BaseModel):
    name: Optional[str] = None
    capacity: Optional[int] = Field(default=None, gt=0)
    section: Optional[str] = None
    active: Optional[bool] = None


class TableAssignRequest(BaseModel):
    table_id: Optional[str] = None


class _ConnWrapper:
    """Mimics sqlite3.Connection's conn.execute(...) convenience method (which returns a
    fetchable cursor) on top of psycopg2, so every existing `conn.execute(...).fetchone()`
    call site throughout this file keeps working unchanged.
    """

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur

    def commit(self) -> None:
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()


@contextmanager
def db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    wrapped = _ConnWrapper(conn)
    try:
        yield wrapped
        wrapped.commit()
    finally:
        wrapped.close()


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                guests INTEGER NOT NULL,
                special_requests TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                bill_amount REAL DEFAULT 0,
                created_at TEXT NOT NULL,
                confirmed_at TEXT,
                visited_at TEXT,
                reminder_24h_at TEXT,
                reminder_2h_at TEXT,
                review_requested_at TEXT,
                review_requested INTEGER NOT NULL DEFAULT 0,
                no_show INTEGER NOT NULL DEFAULT 0,
                table_id TEXT,
                table_name TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS loyalty (
                phone TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                total_points INTEGER NOT NULL DEFAULT 0,
                visit_count INTEGER NOT NULL DEFAULT 0,
                last_visit TEXT,
                vouchers_issued INTEGER NOT NULL DEFAULT 0,
                last_voucher_code TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS message_log (
                id TEXT PRIMARY KEY,
                phone TEXT NOT NULL,
                direction TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                reviewer_name TEXT NOT NULL,
                phone TEXT,
                review_text TEXT NOT NULL,
                rating INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'Manual',
                created_at TEXT NOT NULL,
                responded_at TEXT,
                draft_response TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                phone TEXT NOT NULL,
                guest_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'sent',
                message TEXT NOT NULL,
                related_booking_id TEXT,
                sent_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                phone TEXT PRIMARY KEY,
                stage TEXT NOT NULL,
                guest_name TEXT,
                date TEXT,
                time TEXT,
                guests INTEGER,
                special_requests TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS waitlist (
                id TEXT PRIMARY KEY,
                guest_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                date TEXT NOT NULL,
                session TEXT NOT NULL,
                guests INTEGER NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'waiting',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS restaurant_tables (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                capacity INTEGER NOT NULL,
                section TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        _seed_default_tables(conn)

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS call_analysis (
                id TEXT PRIMARY KEY,
                call_sid TEXT,
                phone TEXT NOT NULL,
                direction TEXT NOT NULL,
                extracted_json TEXT NOT NULL,
                transcript TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def _seed_default_tables(conn) -> None:
    """Seed a starter floor plan matching JING's verified 90-seat capacity (individual mini
    induction pots, up to 4 per table). These are placeholders — edit them in the dashboard
    to match the real floor plan; nothing here is confirmed restaurant layout data.
    """
    existing = conn.execute("SELECT COUNT(*) AS n FROM restaurant_tables").fetchone()["n"]
    if existing:
        return
    created_at = datetime.now(timezone.utc).isoformat()
    layout = [(f"T{i}", 4, "Main Floor") for i in range(1, 21)] + [
        (f"T{i}", 5, "Main Floor") for i in range(21, 23)
    ]
    for name, capacity, section in layout:
        conn.execute(
            "INSERT INTO restaurant_tables (id, name, capacity, section, active, created_at) VALUES (%s, %s, %s, %s, 1, %s)",
            (str(uuid.uuid4()), name, capacity, section, created_at),
        )


@app.on_event("startup")
async def startup() -> None:
    init_db()
    await presynthesize_greeting()


# Run once at import time too, since test clients and some ASGI runners never
# fire the startup lifecycle event.
init_db()


def now_iso() -> str:
    return datetime.now(LOCAL_TZ).isoformat()


def now_local() -> datetime:
    return datetime.now(LOCAL_TZ)


def to_booking_datetime(date_str: str, time_str: str) -> datetime:
    normalized_date = normalize_date(date_str)
    return datetime.fromisoformat(f"{normalized_date}T{time_str}:00").replace(tzinfo=LOCAL_TZ)


def twilio_client() -> Optional[TwilioClient]:
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_NUMBER):
        return None
    return TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)


def send_whatsapp_message(
    phone: str,
    body: str,
    content_sid: Optional[str] = None,
    content_variables: Optional[dict[str, str]] = None,
) -> bool:
    global LAST_TWILIO_ERROR
    client = twilio_client()
    if not client:
        LAST_TWILIO_ERROR = "Twilio credentials or WhatsApp sender are missing"
        return False
    try:
        kwargs: dict = {
            "from_": TWILIO_WHATSAPP_NUMBER,
            "to": f"whatsapp:{phone}",
        }
        use_templates = os.getenv("USE_WHATSAPP_TEMPLATES", "false").lower() == "true"
        if use_templates and content_sid:
            kwargs["content_sid"] = content_sid
            if content_variables:
                kwargs["content_variables"] = json.dumps(content_variables)
        else:
            kwargs["body"] = body
        client.messages.create(**kwargs)
        LAST_TWILIO_ERROR = None
        insert_message(phone, "out", body)
        return True
    except Exception as exc:
        insert_message(phone, "out", f"[send-failed] {body}")
        LAST_TWILIO_ERROR = str(exc)
        print(f"Twilio send failed for {phone}: {exc}")
        return False


def sandbox_join_url() -> Optional[str]:
    raw_number = TWILIO_WHATSAPP_NUMBER.replace("whatsapp:", "").replace("+", "")
    if not raw_number or not TWILIO_SANDBOX_CODE:
        return None
    code = TWILIO_SANDBOX_CODE.strip().lower()
    if code.startswith("join "):
        code = code[5:].strip()
    encoded_message = f"join {code}".replace(" ", "%20")
    return f"https://api.whatsapp.com/send/?phone={raw_number}&text={encoded_message}&type=phone_number&app_absent=0"


def twilio_diagnostics() -> dict:
    configured = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_NUMBER)
    sender_format_ok = TWILIO_WHATSAPP_NUMBER.startswith("whatsapp:+") and not TWILIO_WHATSAPP_NUMBER.startswith("whatsapp:++")
    template_configured = bool(TWILIO_CONFIRMATION_CONTENT_SID)
    sandbox_url = sandbox_join_url()
    sandbox_code = TWILIO_SANDBOX_CODE.strip().lower()
    if sandbox_code.startswith("join "):
        sandbox_code = sandbox_code[5:].strip()
    return {
        "configured": configured,
        "sender": TWILIO_WHATSAPP_NUMBER,
        "sender_format_ok": sender_format_ok,
        "account_sid_present": bool(TWILIO_ACCOUNT_SID),
        "auth_token_present": bool(TWILIO_AUTH_TOKEN),
        "templates_configured": template_configured,
        "confirmation_template": TWILIO_CONFIRMATION_CONTENT_SID or None,
        "reminder_template": TWILIO_REMINDER_CONTENT_SID or None,
        "review_template": TWILIO_REVIEW_CONTENT_SID or None,
        "loyalty_template": TWILIO_LOYALTY_CONTENT_SID or None,
        "last_error": LAST_TWILIO_ERROR,
        "sandbox_url": sandbox_url,
        "sandbox_instructions": (
            f"Open the link and send 'join {sandbox_code}' from WhatsApp to start testing."
            if sandbox_url else
            "Add TWILIO_SANDBOX_CODE to .env to generate the WhatsApp join link."
        ),
        "advice": (
            "WhatsApp templates are configured. Business-initiated messages will use them."
            if configured and template_configured else
            "Business-initiated WhatsApp messages require approved templates. Add Content SIDs to .env."
            if configured else
            "Add Twilio SID, auth token, and WhatsApp sender to .env."
        ),
    }


def transcribe_voice_message(media_url: str, media_content_type: Optional[str] = None) -> Optional[str]:
    if not DEEPGRAM_API_KEY:
        return None

    with httpx.Client(timeout=60.0) as client_http:
        audio_response = client_http.get(media_url, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN))
        audio_response.raise_for_status()

        deepgram_response = client_http.post(
            f"https://api.deepgram.com/v1/listen?model={DEEPGRAM_MODEL}&punctuate=true&smart_format=true",
            headers={
                "Authorization": f"Token {DEEPGRAM_API_KEY}",
                "Content-Type": media_content_type or "application/octet-stream",
            },
            content=audio_response.content,
        )
        deepgram_response.raise_for_status()

    payload = deepgram_response.json()
    transcript = (
        payload.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
        .strip()
    )
    return transcript or None


def get_upcoming_bookings(phone: str, limit: int = 5) -> list[dict]:
    today = now_local().date().isoformat()
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bookings WHERE phone = %s AND date >= %s ORDER BY date ASC, time ASC LIMIT %s",
            (phone, today, limit),
        ).fetchall()
        return [dict(row) for row in rows]


def format_booking_list(bookings: list[dict]) -> str:
    if not bookings:
        return "You don't have any upcoming bookings on record."
    lines = ["Here are your upcoming bookings:"]
    for booking in bookings:
        lines.append(
            f"• {booking['date']} at {booking['time']} for {booking['guests']} guest(s) — {booking['status']}"
        )
    return "\n".join(lines)


def detect_intent(text: str) -> str:
    lowered = text.lower()
    if any(word in lowered for word in ["hi", "hello", "hey", "start"]):
        return "greeting"
    if any(word in lowered for word in ["help", "support", "assist", "what can you do"]):
        return "help"
    if any(word in lowered for word in ["book", "reserve", "table", "reservation"]):
        return "book"
    if any(word in lowered for word in ["my booking", "upcoming", "my reservation", "my bookings"]):
        return "bookings"
    if any(word in lowered for word in ["point", "loyalty", "reward", "voucher", "member"]):
        return "loyalty"
    if any(word in lowered for word in ["review", "feedback", "rate", "google review"]):
        return "review"
    if any(word in lowered for word in ["cancel", "stop", "abort"]):
        return "cancel"
    return "unknown"


def review_link_url() -> str:
    if GOOGLE_PLACE_ID:
        return f"https://search.google.com/local/writereview?placeid={GOOGLE_PLACE_ID}"
    return GOOGLE_REVIEW_FALLBACK_URL or ""


def get_recent_messages(phone: str, limit: int = 10) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT direction, message, created_at FROM message_log WHERE phone = %s ORDER BY created_at DESC LIMIT %s",
            (phone, limit),
        ).fetchall()
    history = []
    for row in reversed(rows):
        message = row["message"]
        if message.startswith("[send-failed]"):
            continue
        role = "user" if row["direction"] == "in" else "assistant"
        history.append({"role": role, "content": message})
    return history


def rule_engine_reply(phone: str, text: str, intent: str) -> str:
    if intent == "greeting":
        return (
            f"Hi there! Welcome to {RESTAURANT_NAME}. "
            "I can help you book a table, check your upcoming bookings, view loyalty points, or request a review link. What would you like to do?"
        )
    if intent == "help":
        return (
            "Here's what I can help with:\n"
            "• Book a table — just say 'Book a table'\n"
            "• Check your upcoming bookings — say 'My bookings'\n"
            "• View loyalty points and vouchers — say 'Loyalty points'\n"
            "• Request a review link — say 'Leave a review'\n"
            "Reply with CANCEL at any time to stop a booking."
        )
    if intent == "book":
        start_booking_session(phone)
        return session_message("name")
    if intent == "bookings":
        bookings = get_upcoming_bookings(phone)
        return format_booking_list(bookings)
    if intent == "loyalty":
        loyalty = get_loyalty(phone, "Guest")
        vouchers = f" Voucher code: {loyalty['last_voucher_code']}" if loyalty.get("last_voucher_code") else ""
        return (
            f"Hi {loyalty['guest_name']}, you have {loyalty['total_points']} loyalty points "
            f"across {loyalty['visit_count']} visit(s).{vouchers} "
            f"Reach {LOYALTY_THRESHOLD} points to unlock a {LOYALTY_REWARD_PCT}% reward."
        )
    if intent == "review":
        link = review_link_url()
        link_text = f" Click here: {link}" if link else ""
        return (
            f"Thank you for dining at {RESTAURANT_NAME}! We'd love your feedback.{link_text} "
            "Reply BOOK if you'd also like to make a new reservation."
        )
    return (
        f"Thanks for contacting {RESTAURANT_NAME}. "
        "I can help with bookings, loyalty points, reviews, and more. Say HELP for options or BOOK to reserve a table."
    )


def process_whatsapp_text(phone: str, text: str) -> str:
    history_before = get_recent_messages(phone, limit=10)
    insert_message(phone, "in", text)
    session = get_session(phone)
    intent = detect_intent(text)

    if intent == "cancel" and session:
        delete_session(phone)
        response_text = "Your booking request has been cancelled. Send a new message anytime to start again."
        insert_message(phone, "out", response_text)
        return response_text

    if session:
        response_text, _ = advance_booking_session(session, text)
    elif client:
        try:
            response_text = run_ai_concierge(phone, text, history_before)
        except Exception as exc:  # noqa: BLE001 - AI path must never break the conversation
            logger.warning("AI concierge failed for %s, falling back to rule engine: %s", phone, exc)
            response_text = rule_engine_reply(phone, text, intent)
    else:
        response_text = rule_engine_reply(phone, text, intent)

    insert_message(phone, "out", response_text)
    return response_text


AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_availability",
            "description": "Check remaining buffet seats and per-person price for a given date and session before booking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "ISO date YYYY-MM-DD. Resolve relative terms like 'Friday' or 'next week' to a real date yourself first."},
                    "session": {"type": "string", "enum": ["lunch", "dinner"], "description": "Buffet session."},
                    "guests": {"type": ["integer", "string"], "description": "Party size, as a number."},
                },
                "required": ["date", "session"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reservation",
            "description": (
                "Create a confirmed buffet reservation once the guest has given name, date, time, and party size, "
                "and has explicitly confirmed they want to book. If the session is full, the guest is automatically "
                "waitlisted instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "guest_name": {"type": "string"},
                    "date": {"type": "string", "description": "ISO date YYYY-MM-DD."},
                    "time": {"type": "string", "description": "24-hour HH:MM."},
                    "guests": {"type": ["integer", "string"], "description": "Party size, as a number."},
                    "special_requests": {"type": "string", "description": "Dietary notes, celebrations, soup base preference, etc."},
                },
                "required": ["guest_name", "date", "time", "guests"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_bookings",
            "description": "Look up this guest's upcoming bookings by their WhatsApp phone number.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_loyalty_status",
            "description": "Look up this guest's loyalty points, visit count, and voucher status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "join_waitlist",
            "description": "Add the guest to the waitlist for a date/session that is fully booked.",
            "parameters": {
                "type": "object",
                "properties": {
                    "guest_name": {"type": "string"},
                    "date": {"type": "string"},
                    "session": {"type": "string", "enum": ["lunch", "dinner"]},
                    "guests": {"type": ["integer", "string"], "description": "Party size, as a number."},
                    "notes": {"type": "string"},
                },
                "required": ["guest_name", "date", "session", "guests"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_review_link",
            "description": "Get the Google review link to share with a guest who wants to leave feedback.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_link",
            "description": (
                "Text the guest a link via WhatsApp instead of reading a long URL aloud. Use this on phone calls "
                "whenever a guest wants the menu, a review link, Instagram/Facebook, or the website — sends to "
                "their own phone number, which is already known."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "link_type": {
                        "type": "string",
                        "enum": ["review", "menu", "instagram", "facebook", "website", "opentable"],
                        "description": "Which link to send.",
                    }
                },
                "required": ["link_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "notify_staff",
            "description": (
                "Notify restaurant staff directly via WhatsApp with the guest's contact info and request. Use this "
                "for group bookings, private events, or large parties — these need a human to arrange, not the AI. "
                "On a phone call, also use transfer_to_staff alongside this so staff both get a live call and a "
                "written note in case the call isn't picked up."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "What the guest wants, e.g. '20-person birthday event on Dec 5'."},
                },
                "required": ["reason"],
            },
        },
    },
]


def execute_tool_call(name: str, args: dict, phone: str) -> dict:
    if name == "check_availability":
        date = normalize_date(args.get("date", ""))
        session = args.get("session") or "dinner"
        snap = capacity_snapshot(date).get(session, {})
        return {
            "date": date,
            "session": session,
            "seats_remaining": snap.get("remaining"),
            "price_per_person_sgd": snap.get("price_per_person"),
            "last_seating": snap.get("last_seating"),
        }

    if name == "create_reservation":
        payload = BookingCreate(
            guest_name=args["guest_name"],
            phone=phone,
            date=normalize_date(args["date"]),
            time=normalize_time(args["time"]),
            guests=int(args["guests"]),
            special_requests=args.get("special_requests", "") or "",
        )
        try:
            booking = create_booking(payload)
            return {"status": "confirmed", "booking": booking}
        except CapacityExceededError as exc:
            entry = add_waitlist_entry(
                payload.guest_name, phone, payload.date, exc.session, payload.guests,
                notes="Auto-added: buffet session was fully booked.",
            )
            return {
                "status": "waitlisted",
                "reason": f"Only {exc.seats_remaining} seat(s) left for {exc.session} on {payload.date}.",
                "waitlist_entry": entry,
            }

    if name == "get_my_bookings":
        return {"bookings": get_upcoming_bookings(phone)}

    if name == "get_loyalty_status":
        return get_loyalty(phone, "Guest")

    if name == "join_waitlist":
        entry = add_waitlist_entry(
            args["guest_name"], phone, normalize_date(args["date"]), args["session"],
            int(args["guests"]), args.get("notes", "") or "",
        )
        return {"status": "waitlisted", "waitlist_entry": entry}

    if name == "request_review_link":
        return {"review_link": review_link_url() or "Link not configured yet — ask a staff member for the Google review page."}

    if name == "send_link":
        return send_link_via_whatsapp(phone, args.get("link_type", ""))

    if name == "notify_staff":
        return notify_staff_via_whatsapp(phone, args.get("reason", "Guest inquiry needs staff follow-up."))

    return {"error": f"Unknown tool '{name}'"}


def notify_staff_via_whatsapp(customer_phone: str, reason: str) -> dict:
    if not STAFF_TRANSFER_NUMBER:
        return {"status": "failed", "note": "STAFF_TRANSFER_NUMBER is not configured — nowhere to send the notification."}
    body = (
        f"[{RESTAURANT_NAME}] Guest needs staff follow-up.\n"
        f"Contact: {customer_phone}\n"
        f"Request: {reason}"
    )
    success = send_whatsapp_message(STAFF_TRANSFER_NUMBER, body)
    record_campaign("staff_notification", customer_phone, "Guest", "sent" if success else "failed", body)
    return {
        "status": "sent" if success else "failed",
        "note": "Staff notified via WhatsApp with the guest's contact." if success else "Could not reach staff via WhatsApp.",
    }


def send_link_via_whatsapp(phone: str, link_type: str) -> dict:
    links = knowledge.social_links()
    url_map = {
        "review": review_link_url() or links["google_review_fallback"],
        "menu": links["website"],
        "instagram": links["instagram"],
        "facebook": links["facebook"],
        "website": links["website"],
        "opentable": links["opentable"],
    }
    url = url_map.get(link_type)
    if not url:
        return {"error": f"Unknown link_type '{link_type}'"}

    label = link_type.replace("_", " ").title()
    body = f"Hi from {RESTAURANT_NAME}! Here's the {label} link you asked for: {url}"
    success = send_whatsapp_message(phone, body)
    return {
        "status": "sent" if success else "failed",
        "link_type": link_type,
        "url": url,
        "note": "Sent via WhatsApp to the guest's number." if success else "Could not send WhatsApp message — Twilio may not be configured.",
    }


def run_ai_concierge(phone: str, text: str, history: list[dict]) -> str:
    today = now_local()
    system_prompt = f"""
You are the AI concierge for {RESTAURANT_NAME}, a halal Chinese hotpot & grill buffet in Singapore.
Today is {today.strftime('%A, %Y-%m-%d')}. The guest's WhatsApp phone number is already known ({phone}) — never ask for it.

{knowledge.knowledge_prompt_block()}

Guidelines:
- Be warm, concise (2-4 short sentences or a tight bullet list), and proud of the halal, Muslim-owned identity.
- Never invent menu items, prices, or hours — only use the facts above. Use the tools for anything involving real bookings, availability, loyalty points, or the review link.
- Before calling create_reservation, make sure you have guest name, date, time, and party size, and the guest has clearly said to go ahead / confirm.
- If you already confirmed this exact booking earlier in the conversation, do NOT call create_reservation again — a guest saying "yes"/"confirm" afterward is just acknowledging, not requesting a second booking.
- If a soup base or dietary preference is mentioned, store it in special_requests.
- When a booking is confirmed, mention the session's per-person price and the {BUFFET_DURATION_MINUTES}-minute seating window.
- If a slot is full, the tool will waitlist the guest automatically — reassure them and offer an alternate date/time.
- You may suggest the {knowledge.PRICING['premium_platter']['name']} (S${knowledge.PRICING['premium_platter']['price']:.2f}) as a nice upsell when it fits naturally, but don't force it.
- This is a WhatsApp text conversation — just type links directly in your reply. Don't use the send_link tool here, it would send a separate redundant message; the guest is already reading your text.
- For group bookings, private events, or large parties: use the notify_staff tool so a human follows up, and tell the guest staff will be in touch shortly. Don't try to arrange these yourself.
""".strip()

    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": text}]

    for _ in range(4):
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            tools=AGENT_TOOLS,
            tool_choice="auto",
            temperature=0.4,
            max_tokens=400,
        )
        message = completion.choices[0].message
        tool_calls = getattr(message, "tool_calls", None)
        if not tool_calls:
            return _strip_leaked_function_syntax((message.content or "").strip() or "Sorry, could you rephrase that?")

        messages.append({
            "role": "assistant",
            "content": message.content or "",
            "tool_calls": [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.function.name, "arguments": call.function.arguments},
                }
                for call in tool_calls
            ],
        })
        for call in tool_calls:
            try:
                args = json.loads(call.function.arguments or "{}")
                result = execute_tool_call(call.function.name, args, phone)
            except Exception as exc:  # noqa: BLE001 - surface the failure to the model, not the guest
                result = {"error": str(exc)}
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(result, default=str),
            })

    return "I'm having trouble completing that right now — could you try again, or say HELP for options?"


def insert_message(phone: str, direction: str, message: str) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO message_log (id, phone, direction, message, created_at) VALUES (%s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), phone, direction, message, now_iso()),
        )


def get_session(phone: str) -> Optional[dict]:
    with db() as conn:
        row = conn.execute("SELECT * FROM whatsapp_sessions WHERE phone = %s", (phone,)).fetchone()
        return dict(row) if row else None


def save_session(session: WhatsAppBookingSession) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO whatsapp_sessions (phone, stage, guest_name, date, time, guests, special_requests, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(phone) DO UPDATE SET
                stage = excluded.stage,
                guest_name = excluded.guest_name,
                date = excluded.date,
                time = excluded.time,
                guests = excluded.guests,
                special_requests = excluded.special_requests,
                updated_at = excluded.updated_at
            """,
            (
                session.phone,
                session.stage,
                session.guest_name,
                session.date,
                session.time,
                session.guests,
                session.special_requests,
                now_iso(),
            ),
        )


def delete_session(phone: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM whatsapp_sessions WHERE phone = %s", (phone,))


def session_message(stage: str) -> str:
    prompts = {
        "name": "Welcome to {restaurant}. What name should I book under?",
        "date": "Thanks. What date would you like to reserve? Please send YYYY-MM-DD or a clear date like Friday.",
        "time": "What time should I reserve? Please send HH:MM in 24-hour time, for example 19:30.",
        "guests": "How many guests should I reserve for?",
        "special_requests": "Any special requests, celebrations, or dietary needs?",
        "confirm": "Booking details saved. Reply CONFIRM to create the booking or CANCEL to stop.",
    }
    return prompts.get(stage, prompts["name"]).format(restaurant=RESTAURANT_NAME)


def normalize_date(value: str) -> str:
    value = value.strip()
    if not value:
        return value
    lowered = value.lower()
    if lowered in {"today", "tonight"}:
        return now_local().date().isoformat()
    if lowered == "tomorrow":
        return (now_local().date() + timedelta(days=1)).isoformat()

    try:
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        pass

    try:
        parsed = datetime.strptime(value, "%d-%m-%Y")
        return parsed.date().isoformat()
    except ValueError:
        pass

    try:
        parsed = datetime.strptime(value, "%d/%m/%Y")
        return parsed.date().isoformat()
    except ValueError:
        pass

    try:
        parsed = datetime.strptime(value, "%d-%m-%y")
        return parsed.date().isoformat()
    except ValueError:
        pass

    return value


def normalize_time(value: str) -> str:
    value = value.strip().lower().replace(" ", "")
    if value.endswith("pm") or value.endswith("am"):
        meridiem = value[-2:]
        hour_minute = value[:-2]
        if ":" in hour_minute:
            hour_str, minute_str = hour_minute.split(":", 1)
        else:
            hour_str, minute_str = hour_minute, "00"
        hour = int(hour_str)
        minute = int(minute_str)
        if meridiem == "pm" and hour != 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"
    if len(value) == 4 and value.isdigit():
        return f"{value[:2]}:{value[2:]}"
    return value


def start_booking_session(phone: str) -> dict:
    session = WhatsAppBookingSession(phone=phone, stage="name")
    save_session(session)
    return session.model_dump()


def advance_booking_session(session: dict, text: str) -> tuple[str, Optional[dict]]:
    stage = session["stage"]
    text = text.strip()
    if text.upper() == "CANCEL":
        delete_session(session["phone"])
        return "Your booking request has been cancelled. Send a new message anytime to start again.", None

    if stage == "name":
        session["guest_name"] = text
        session["stage"] = "date"
        save_session(WhatsAppBookingSession(**session))
        return session_message("date"), session

    if stage == "date":
        session["date"] = normalize_date(text)
        session["stage"] = "time"
        save_session(WhatsAppBookingSession(**session))
        return session_message("time"), session

    if stage == "time":
        session["time"] = normalize_time(text)
        session["stage"] = "guests"
        save_session(WhatsAppBookingSession(**session))
        return session_message("guests"), session

    if stage == "guests":
        try:
            session["guests"] = max(1, int(text.split()[0]))
        except (ValueError, IndexError):
            return "Please reply with a number of guests, for example 4.", session
        session["stage"] = "special_requests"
        save_session(WhatsAppBookingSession(**session))
        return session_message("special_requests"), session

    if stage == "special_requests":
        session["special_requests"] = text
        session["stage"] = "confirm"
        save_session(WhatsAppBookingSession(**session))
        summary = (
            f"Guest: {session['guest_name']}\n"
            f"Date: {session['date']}\n"
            f"Time: {session['time']}\n"
            f"Guests: {session['guests']}\n"
            f"Special requests: {session.get('special_requests') or 'None'}\n\n"
            "Reply CONFIRM to create the booking or CANCEL to stop."
        )
        return summary, session

    if stage == "confirm":
        if text.upper() != "CONFIRM":
            return "Please reply CONFIRM to create the booking or CANCEL to stop.", session
        payload = BookingCreate(
            guest_name=session["guest_name"],
            phone=session["phone"],
            date=session["date"],
            time=session["time"],
            guests=int(session["guests"]),
            special_requests=session.get("special_requests") or "",
        )
        try:
            booking = create_booking(payload)
        except CapacityExceededError as exc:
            add_waitlist_entry(
                payload.guest_name, payload.phone, payload.date, exc.session, payload.guests,
                notes="Auto-added: buffet session was fully booked.",
            )
            delete_session(session["phone"])
            return (
                f"That {knowledge.SESSIONS[exc.session]['label'].lower()} seating on {payload.date} is fully booked "
                f"(only {exc.seats_remaining} seat(s) left). I've added you to the waitlist and we'll message you "
                f"the moment a table opens up. Reply BOOK to try a different date or time instead.",
                None,
            )
        delete_session(session["phone"])
        return (
            f"Booking confirmed for {booking['guest_name']} on {booking['date']} at {booking['time']}. "
            f"We have scheduled reminders and saved the booking.",
            None,
        )

    delete_session(session["phone"])
    return session_message("name"), start_booking_session(session["phone"])


def seats_booked_for(date: str, session: str) -> int:
    with db() as conn:
        rows = conn.execute(
            "SELECT time, guests FROM bookings WHERE date = %s AND status IN ('confirmed', 'visited')",
            (date,),
        ).fetchall()
    return sum(row["guests"] for row in rows if knowledge.session_for_time(row["time"]) == session)


def capacity_snapshot(date: str) -> dict:
    snapshot = {}
    for session_key, session_info in knowledge.SESSIONS.items():
        booked = seats_booked_for(date, session_key)
        remaining = max(0, SEATING_CAPACITY - booked)
        snapshot[session_key] = {
            "label": session_info["label"],
            "booked": booked,
            "remaining": remaining,
            "capacity": SEATING_CAPACITY,
            "price_per_person": knowledge.price_for(date, session_key),
            "last_seating": session_info["last_seating"],
        }
    return snapshot


def add_waitlist_entry(guest_name: str, phone: str, date: str, session: str, guests: int, notes: str = "") -> dict:
    entry_id = str(uuid.uuid4())
    created_at = now_iso()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO waitlist (id, guest_name, phone, date, session, guests, notes, status, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'waiting', %s)
            """,
            (entry_id, guest_name, phone, date, session, guests, notes, created_at),
        )
    return {
        "id": entry_id,
        "guest_name": guest_name,
        "phone": phone,
        "date": date,
        "session": session,
        "guests": guests,
        "notes": notes,
        "status": "waiting",
        "created_at": created_at,
    }


def list_waitlist(limit: int = 100) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_tables(include_inactive: bool = False) -> list[dict]:
    with db() as conn:
        query = "SELECT * FROM restaurant_tables"
        if not include_inactive:
            query += " WHERE active = 1"
        query += " ORDER BY name ASC"
        rows = conn.execute(query).fetchall()
    return [dict(row) for row in rows]


def create_table(payload: TableCreate) -> dict:
    table_id = str(uuid.uuid4())
    created_at = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO restaurant_tables (id, name, capacity, section, active, created_at) VALUES (%s, %s, %s, %s, 1, %s)",
            (table_id, payload.name, payload.capacity, payload.section, created_at),
        )
    return {"id": table_id, "name": payload.name, "capacity": payload.capacity, "section": payload.section, "active": 1}


def update_table(table_id: str, payload: TableUpdate) -> dict:
    with db() as conn:
        existing = conn.execute("SELECT * FROM restaurant_tables WHERE id = %s", (table_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Table not found")
        merged = dict(existing)
        updates = payload.model_dump(exclude_unset=True)
        merged.update(updates)
        conn.execute(
            "UPDATE restaurant_tables SET name = %s, capacity = %s, section = %s, active = %s WHERE id = %s",
            (merged["name"], merged["capacity"], merged["section"], int(merged["active"]), table_id),
        )
    return get_table(table_id)


def get_table(table_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM restaurant_tables WHERE id = %s", (table_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Table not found")
        return dict(row)


def assign_table_to_booking(booking_id: str, table_id: Optional[str]) -> dict:
    with db() as conn:
        booking = conn.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,)).fetchone()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        table_name = None
        if table_id:
            table = conn.execute("SELECT * FROM restaurant_tables WHERE id = %s", (table_id,)).fetchone()
            if not table:
                raise HTTPException(status_code=404, detail="Table not found")
            table_name = table["name"]
        conn.execute(
            "UPDATE bookings SET table_id = %s, table_name = %s WHERE id = %s",
            (table_id, table_name, booking_id),
        )
    return get_booking(booking_id)


def find_recent_duplicate_booking(payload: BookingCreate, window_minutes: int = 15) -> Optional[dict]:
    """Guard against double-booking from AI re-confirmation chatter, double-taps, or client retries."""
    cutoff = (now_local() - timedelta(minutes=window_minutes)).isoformat()
    with db() as conn:
        row = conn.execute(
            """
            SELECT * FROM bookings
            WHERE phone = %s AND date = %s AND time = %s AND guests = %s AND status = 'confirmed' AND created_at >= %s
            ORDER BY created_at DESC LIMIT 1
            """,
            (payload.phone, payload.date, payload.time, payload.guests, cutoff),
        ).fetchone()
    return dict(row) if row else None


def create_booking(payload: BookingCreate, enforce_capacity: bool = True) -> dict:
    duplicate = find_recent_duplicate_booking(payload)
    if duplicate:
        return duplicate
    session = knowledge.session_for_time(payload.time)
    if enforce_capacity:
        booked = seats_booked_for(payload.date, session)
        remaining = SEATING_CAPACITY - booked
        if payload.guests > remaining:
            raise CapacityExceededError(payload.date, session, max(0, remaining), payload.guests)
    booking_id = str(uuid.uuid4())
    created_at = now_iso()
    reminder_24h_at = (to_booking_datetime(payload.date, payload.time) - timedelta(hours=24)).isoformat()
    reminder_2h_at = (to_booking_datetime(payload.date, payload.time) - timedelta(hours=2)).isoformat()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO bookings (
                id, guest_name, phone, date, time, guests, special_requests, status,
                created_at, confirmed_at, reminder_24h_at, reminder_2h_at, review_requested, no_show
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 0)
            """,
            (
                booking_id,
                payload.guest_name,
                payload.phone,
                payload.date,
                payload.time,
                payload.guests,
                payload.special_requests,
                "confirmed",
                created_at,
                created_at,
                reminder_24h_at,
                reminder_2h_at,
            ),
        )
    booking = get_booking(booking_id)
    schedule_booking_messages(booking)
    return booking


def schedule_booking_messages(booking: dict) -> None:
    booking_dt = to_booking_datetime(booking["date"], booking["time"])
    session = knowledge.session_for_time(booking["time"])
    price = knowledge.price_for(booking["date"], session)
    confirmation_text = (
        f"Booking confirmed at {RESTAURANT_NAME}. "
        f"Date: {booking['date']} Time: {booking['time']} Guests: {booking['guests']} "
        f"({knowledge.SESSIONS[session]['label']} buffet, S${price:.2f}++/pax, {BUFFET_DURATION_MINUTES}-min seating). "
        f"Halal-certified. Ask about the {knowledge.PRICING['premium_platter']['name']} if you'd like to go premium."
    )
    reminder_24h_text = (
        f"Reminder: your table at {RESTAURANT_NAME} is tomorrow at {booking['time']}. "
        f"Reply CANCEL if plans change."
    )
    reminder_2h_text = (
        f"Reminder: your table at {RESTAURANT_NAME} is today at {booking['time']}. "
        f"We look forward to welcoming you soon."
    )
    now = now_local()
    # Dispatched through the scheduler (not called directly) so a slow/hung Twilio API
    # call can never block the request that created the booking — on a live phone call,
    # that blocking previously stalled the AI's spoken confirmation until the WhatsApp
    # send finished, which could leave the caller on a silent line.
    scheduler.add_job(
        send_whatsapp_message,
        trigger="date",
        run_date=now,
        kwargs={
            "phone": booking["phone"],
            "body": confirmation_text,
            "content_sid": TWILIO_CONFIRMATION_CONTENT_SID or None,
            "content_variables": {
                "1": booking["guest_name"],
                "2": RESTAURANT_NAME,
                "3": booking["date"],
                "4": booking["time"],
                "5": str(booking["guests"]),
            } if TWILIO_CONFIRMATION_CONTENT_SID else None,
        },
        id=f"booking-confirmation-{booking['id']}",
        replace_existing=True,
    )

    if STAFF_TRANSFER_NUMBER:
        staff_notification_text = (
            f"New booking: {booking['guest_name']} ({booking['phone']}) — "
            f"{booking['date']} at {booking['time']}, {booking['guests']} guest(s), "
            f"{knowledge.SESSIONS[session]['label']} session."
            + (f" Notes: {booking['special_requests']}" if booking.get("special_requests") else "")
        )
        scheduler.add_job(
            send_whatsapp_message,
            trigger="date",
            run_date=now,
            kwargs={"phone": STAFF_TRANSFER_NUMBER, "body": staff_notification_text},
            id=f"booking-staff-notify-{booking['id']}",
            replace_existing=True,
        )

    if booking_dt - timedelta(hours=24) > now:
        scheduler.add_job(
            send_whatsapp_message,
            trigger="date",
            run_date=booking_dt - timedelta(hours=24),
            kwargs={
                "phone": booking["phone"],
                "body": reminder_24h_text,
                "content_sid": TWILIO_REMINDER_CONTENT_SID or None,
                "content_variables": {
                    "1": RESTAURANT_NAME,
                    "2": booking["date"],
                    "3": booking["time"],
                } if TWILIO_REMINDER_CONTENT_SID else None,
            },
            id=f"booking-reminder-24h-{booking['id']}",
            replace_existing=True,
        )

    if booking_dt - timedelta(hours=2) > now:
        scheduler.add_job(
            send_whatsapp_message,
            trigger="date",
            run_date=booking_dt - timedelta(hours=2),
            kwargs={
                "phone": booking["phone"],
                "body": reminder_2h_text,
                "content_sid": TWILIO_REMINDER_CONTENT_SID or None,
                "content_variables": {
                    "1": RESTAURANT_NAME,
                    "2": booking["date"],
                    "3": booking["time"],
                } if TWILIO_REMINDER_CONTENT_SID else None,
            },
            id=f"booking-reminder-2h-{booking['id']}",
            replace_existing=True,
        )


def get_booking(booking_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        return dict(row)


def list_bookings(limit: int = 50) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bookings ORDER BY created_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def todays_bookings() -> list[dict]:
    today = now_local().date().isoformat()
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bookings WHERE date = %s ORDER BY time ASC",
            (today,),
        ).fetchall()
        return [dict(row) for row in rows]


def mark_visited(booking_id: str, bill_amount: float) -> dict:
    booking = get_booking(booking_id)
    visited_at = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE bookings SET status = %s, visited_at = %s, bill_amount = %s WHERE id = %s",
            ("visited", visited_at, bill_amount, booking_id),
        )
    loyalty = award_points(booking["phone"], booking["guest_name"], bill_amount)
    schedule_review_request(booking["phone"], booking["guest_name"], booking_id)
    booking["status"] = "visited"
    booking["visited_at"] = visited_at
    booking["bill_amount"] = bill_amount
    booking["loyalty"] = loyalty
    return booking


def mark_no_show(booking_id: str) -> dict:
    booking = get_booking(booking_id)
    with db() as conn:
        conn.execute(
            "UPDATE bookings SET status = %s, no_show = 1 WHERE id = %s",
            ("no_show", booking_id),
        )
    booking["status"] = "no_show"
    booking["no_show"] = 1
    return booking


def get_loyalty(phone: str, guest_name: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM loyalty WHERE phone = %s", (phone,)).fetchone()
        if row:
            return dict(row)
        return {
            "phone": phone,
            "guest_name": guest_name,
            "total_points": 0,
            "visit_count": 0,
            "last_visit": None,
            "vouchers_issued": 0,
            "last_voucher_code": None,
        }


def save_loyalty(record: dict) -> dict:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO loyalty (
                phone, guest_name, total_points, visit_count, last_visit,
                vouchers_issued, last_voucher_code, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(phone) DO UPDATE SET
                guest_name = excluded.guest_name,
                total_points = excluded.total_points,
                visit_count = excluded.visit_count,
                last_visit = excluded.last_visit,
                vouchers_issued = excluded.vouchers_issued,
                last_voucher_code = excluded.last_voucher_code,
                updated_at = excluded.updated_at
            """,
            (
                record["phone"],
                record["guest_name"],
                record["total_points"],
                record["visit_count"],
                record["last_visit"],
                record["vouchers_issued"],
                record["last_voucher_code"],
                now_iso(),
            ),
        )
    return record


def generate_voucher_code() -> str:
    return f"LOYAL-{uuid.uuid4().hex[:8].upper()}"


def award_points(phone: str, guest_name: str, bill_amount: float) -> dict:
    record = get_loyalty(phone, guest_name)
    earned = int(round(bill_amount))
    old_points = int(record.get("total_points") or 0)
    new_points = old_points + earned
    record.update(
        {
            "phone": phone,
            "guest_name": guest_name,
            "total_points": new_points,
            "visit_count": int(record.get("visit_count") or 0) + 1,
            "last_visit": datetime.now(timezone.utc).date().isoformat(),
        }
    )
    reward_unlocked = new_points >= LOYALTY_THRESHOLD and old_points < LOYALTY_THRESHOLD
    if reward_unlocked:
        record["vouchers_issued"] = int(record.get("vouchers_issued") or 0) + 1
        record["last_voucher_code"] = generate_voucher_code()
        record["total_points"] = 0
        loyalty_body = (
            f"Congratulations {guest_name}! You unlocked a {LOYALTY_REWARD_PCT}% reward voucher. "
            f"Your voucher code is {record['last_voucher_code']}."
        )
        send_whatsapp_message(
            phone,
            loyalty_body,
            content_sid=TWILIO_LOYALTY_CONTENT_SID or None,
            content_variables={
                "1": guest_name,
                "2": str(LOYALTY_REWARD_PCT),
                "3": record["last_voucher_code"],
            } if TWILIO_LOYALTY_CONTENT_SID else None,
        )
    save_loyalty(record)
    return {
        "earned": earned,
        "total_points": record["total_points"],
        "reward_unlocked": reward_unlocked,
        "voucher_code": record.get("last_voucher_code"),
        "threshold": LOYALTY_THRESHOLD,
        "reward_pct": LOYALTY_REWARD_PCT,
    }


def schedule_review_request(phone: str, guest_name: str, booking_id: str) -> dict:
    requested_at = (datetime.now(timezone.utc) + timedelta(hours=REVIEW_DELAY_HOURS)).isoformat()
    with db() as conn:
        conn.execute(
            "UPDATE bookings SET review_requested = 1, review_requested_at = %s WHERE id = %s",
            (requested_at, booking_id),
        )
    review_text = build_review_request_message(guest_name, "Google Maps")
    run_at = now_local() + timedelta(hours=REVIEW_DELAY_HOURS)
    scheduler.add_job(
        send_whatsapp_message,
        trigger="date",
        run_date=run_at,
        kwargs={
            "phone": phone,
            "body": review_text,
            "content_sid": TWILIO_REVIEW_CONTENT_SID or None,
            "content_variables": {
                "1": guest_name,
                "2": RESTAURANT_NAME,
            } if TWILIO_REVIEW_CONTENT_SID else None,
        },
        id=f"review-request-{booking_id}",
        replace_existing=True,
    )
    return {
        "phone": phone,
        "guest_name": guest_name,
        "requested_at": requested_at,
    }


def build_review_request_message(guest_name: str, platform: str = "Google Maps") -> str:
    link = review_link_url()
    link_text = f" {link}" if link else ""
    return (
        f"Hi {guest_name}, thank you for dining at {RESTAURANT_NAME}. "
        f"We would love your feedback on {platform}.{link_text}"
        " If you enjoyed your halal hotpot experience, please leave us a quick review."
    )


def build_repurchase_reminder_message(guest_name: str, last_item: str, next_reorder: str = "This week") -> str:
    return (
        f"Hi {guest_name}, thanks again for your recent purchase of {last_item} from {RESTAURANT_NAME}. "
        f"We’d love to help you restock or reorder {next_reorder}."
    )


def send_review_request(phone: str, guest_name: str, platform: str = "Google Maps") -> dict:
    body = build_review_request_message(guest_name, platform)
    success = send_whatsapp_message(
        phone,
        body,
        content_sid=TWILIO_REVIEW_CONTENT_SID or None,
        content_variables={
            "1": guest_name,
            "2": RESTAURANT_NAME,
        } if TWILIO_REVIEW_CONTENT_SID else None,
    )
    status = "sent" if success else "failed"
    record_campaign("review_request", phone, guest_name, status, body)
    return {"success": success, "phone": phone, "guest_name": guest_name, "platform": platform, "message": body}


def send_repurchase_reminder(phone: str, guest_name: str, last_item: str, next_reorder: str = "This week") -> dict:
    body = build_repurchase_reminder_message(guest_name, last_item, next_reorder)
    success = send_whatsapp_message(
        phone,
        body,
        content_sid=TWILIO_REMINDER_CONTENT_SID or None,
        content_variables={
            "1": guest_name,
            "2": last_item,
            "3": next_reorder,
        } if TWILIO_REMINDER_CONTENT_SID else None,
    )
    status = "sent" if success else "failed"
    record_campaign("retail_reminder", phone, guest_name, status, body)
    return {"success": success, "phone": phone, "guest_name": guest_name, "message": body}


def send_instagram_dm(phone: str, guest_name: str, message: str) -> dict:
    reply = process_instagram_dm(phone, message, guest_name)
    status = "sent"
    record_campaign("instagram_dm", phone, guest_name, status, reply)
    return {"success": True, "phone": phone, "guest_name": guest_name, "reply": reply}


def record_campaign(campaign_type: str, phone: str, guest_name: str, status: str, message: str, related_booking_id: Optional[str] = None) -> dict:
    campaign_id = str(uuid.uuid4())
    sent_at = now_iso()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO campaigns (id, type, phone, guest_name, status, message, related_booking_id, sent_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (campaign_id, campaign_type, phone, guest_name, status, message, related_booking_id, sent_at),
        )
    return {
        "id": campaign_id,
        "type": campaign_type,
        "phone": phone,
        "guest_name": guest_name,
        "status": status,
        "message": message,
        "sent_at": sent_at,
    }


def list_campaigns(limit: int = 100) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM campaigns ORDER BY sent_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def create_review_record(reviewer_name: str, phone: str, review_text: str, rating: int, source: str = "Dashboard") -> dict:
    review_id = str(uuid.uuid4())
    created_at = now_iso()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO reviews (id, reviewer_name, phone, review_text, rating, source, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (review_id, reviewer_name, phone, review_text, rating, source, created_at),
        )
    return {
        "id": review_id,
        "reviewer_name": reviewer_name,
        "phone": phone,
        "review_text": review_text,
        "rating": rating,
        "source": source,
        "created_at": created_at,
    }


def list_reviews(limit: int = 100) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM reviews ORDER BY created_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_review_response(review_id: str, draft_response: str) -> dict:
    responded_at = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE reviews SET draft_response = %s, responded_at = %s WHERE id = %s",
            (draft_response, responded_at, review_id),
        )
    return {"id": review_id, "draft_response": draft_response, "responded_at": responded_at}


def process_instagram_dm(phone: str, message: str, guest_name: str = "Guest") -> str:
    insert_message(phone, "in", f"instagram-dm:{message}")
    if any(keyword in message.lower() for keyword in ["book", "reserve", "table", "reservation"]):
        return process_whatsapp_text(phone, message)
    return (
        f"Hi {guest_name}! Thanks for contacting {RESTAURANT_NAME}. "
        "We can help with bookings, reviews, loyalty rewards, and restock reminders."
    )


def draft_review_response(reviewer_name: str, review_text: str, rating: int) -> str:
    if not client:
        raise HTTPException(status_code=400, detail="GROQ_API_KEY is required to draft review responses")

    tone = "warm and grateful" if rating >= 4 else "empathetic and solution-focused"
    prompt = f"""
Write a Google review response for {RESTAURANT_NAME}.
Reviewer: {reviewer_name}
Rating: {rating}/5
Review: {review_text}
Tone: {tone}
Keep it 3-4 short sentences.
Return only the response text.
""".strip()
    completion = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        max_tokens=200,
    )
    return completion.choices[0].message.content.strip()


def whatsapp_reply(text: str) -> Response:
    response = MessagingResponse()
    response.message(text)
    return Response(content=str(response), media_type="application/xml")


@app.get("/", response_class=HTMLResponse)
def root() -> Response:
    html_path = APP_DIR / "index.html"
    content = html_path.read_text(encoding="utf-8")
    content = content.replace(
        '<link rel="stylesheet" href="/assets/styles.css" />',
        f'<link rel="stylesheet" href="/assets/styles.css?v={int(datetime.now(timezone.utc).timestamp())}" />',
    )
    content = content.replace(
        '<script src="/assets/dashboard.js"></script>',
        f'<script src="/assets/dashboard.js?v={int(datetime.now(timezone.utc).timestamp())}"></script>',
    )
    return Response(content=content, media_type="text/html")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "restaurant": RESTAURANT_NAME}


@app.get("/api/bookings")
def api_bookings(limit: int = 50) -> list[dict]:
    return list_bookings(limit)


@app.get("/api/bookings/today")
def api_todays_bookings() -> list[dict]:
    return todays_bookings()


@app.post("/api/bookings")
def api_create_booking(payload: BookingCreate) -> dict:
    try:
        booking = create_booking(payload)
    except CapacityExceededError as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{knowledge.SESSIONS[exc.session]['label']} seating on {exc.date} is full "
                f"({exc.seats_remaining} seat(s) left, {exc.requested} requested). "
                "Use /api/waitlist to add this guest to the waitlist instead."
            ),
        ) from exc
    insert_message(payload.phone, "in", f"booking created for {payload.guest_name}")
    return booking


@app.post("/api/bookings/{booking_id}/visited")
def api_mark_visited(booking_id: str, payload: VisitCompleteRequest) -> dict:
    return mark_visited(booking_id, payload.bill_amount)


@app.post("/api/bookings/{booking_id}/no-show")
def api_mark_no_show(booking_id: str) -> dict:
    return mark_no_show(booking_id)


@app.get("/api/loyalty/{phone}")
def api_loyalty(phone: str, guest_name: str = "Guest") -> dict:
    return get_loyalty(phone, guest_name)


@app.get("/api/loyalty")
def api_loyalty_list(limit: int = 200) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM loyalty ORDER BY updated_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/loyalty/award")
def api_award_loyalty(payload: LoyaltyUpdateRequest) -> dict:
    return award_points(payload.phone, payload.guest_name, payload.bill_amount)


@app.post("/api/reviews/draft")
def api_review_draft(payload: ReviewDraftRequest) -> dict:
    return {"draft_response": draft_review_response(payload.reviewer_name, payload.review_text, payload.rating)}


@app.post("/mark-visited")
def mark_visited_route(payload: VisitRequest) -> dict:
    booking = mark_visited(payload.booking_id, payload.bill_amount)
    loyalty = award_points(payload.guest_phone, payload.guest_name, payload.bill_amount)
    schedule_review_request(payload.guest_phone, payload.guest_name, payload.booking_id)
    return {
        "status": "visit_processed",
        "booking_id": payload.booking_id,
        "points_awarded": int(payload.bill_amount),
        "loyalty": loyalty,
    }


@app.post("/respond-to-review")
def respond_to_review(payload: ReviewRequestPayload) -> dict:
    draft = draft_review_response(payload.reviewer_name, payload.review_text, payload.rating)
    return {"draft_response": draft, "note": "Review and edit before posting to Google Business Profile."}


@app.get("/todays-bookings")
def todays_bookings_route() -> dict:
    bookings = todays_bookings()
    return {"date": now_local().strftime("%Y-%m-%d"), "total": len(bookings), "bookings": bookings}


@app.post("/api/reviews/request")
def api_review_request(payload: ReviewRequestRequest) -> dict:
    return send_review_request(payload.phone, payload.guest_name, payload.platform)


@app.post("/api/retail/reminder")
def api_retail_reminder(payload: RetailReminderRequest) -> dict:
    return send_repurchase_reminder(payload.phone, payload.guest_name, payload.last_item, payload.next_reorder)


@app.post("/api/instagram/dm")
def api_instagram_dm(payload: InstagramDMRequest) -> dict:
    reply = process_instagram_dm(payload.phone, payload.message, payload.guest_name)
    return {"phone": payload.phone, "reply": reply}


@app.post("/webhook/whatsapp")
def webhook_whatsapp(
    From: str = Form(...),
    Body: str = Form(""),
    NumMedia: str = Form("0"),
    MediaUrl0: Optional[str] = Form(None),
    MediaContentType0: Optional[str] = Form(None),
    _signature_ok: None = Depends(verify_twilio_request),
):
    phone = From.replace("whatsapp:", "")
    text = Body.strip()
    logger.info("Webhook received from %s: %s (media=%s)", phone, text, NumMedia)
    if not text and int(NumMedia or "0") > 0 and MediaUrl0:
        transcript = transcribe_voice_message(MediaUrl0, MediaContentType0)
        if transcript:
            text = transcript
        else:
            response_text = (
                f"Thanks for the voice note. I couldn't transcribe it right now. "
                f"Please send a text message or try again in a moment."
            )
            insert_message(phone, "out", response_text)
            logger.info("Voice note transcription failed for %s", phone)
            return whatsapp_reply(response_text)
    response_text = process_whatsapp_text(phone, text)
    logger.info("Webhook reply to %s: %s", phone, response_text[:100])
    return whatsapp_reply(response_text)


@app.post("/api/test/voice-note")
def api_test_voice_note(payload: VoiceBookingTestRequest) -> dict:
    transcript = payload.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript is required")
    response_text = process_whatsapp_text(payload.phone, transcript)
    return {"phone": payload.phone, "transcript": transcript, "reply": response_text}


@app.post("/api/chat/message")
def api_chat_message(payload: ChatMessageRequest) -> dict:
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    response_text = process_whatsapp_text(payload.phone, message)
    session = get_session(payload.phone)
    return {
        "phone": payload.phone,
        "message": message,
        "reply": response_text,
        "active_session": bool(session),
        "session_stage": session["stage"] if session else None,
    }


@app.post("/api/chat/reset")
def api_chat_reset(payload: ChatResetRequest) -> dict:
    delete_session(payload.phone)
    return {"phone": payload.phone, "reset": True}


@app.get("/api/diagnostics/twilio")
def api_twilio_diagnostics() -> dict:
    return twilio_diagnostics()


@app.post("/api/diagnostics/twilio/test")
def api_twilio_test(payload: TwilioTestRequest) -> dict:
    success = send_whatsapp_message(payload.phone, payload.body)
    return {
        "success": success,
        "phone": payload.phone,
        "body": payload.body,
        "diagnostics": twilio_diagnostics(),
    }


@app.get("/api/summary")
def api_summary() -> dict:
    bookings = list_bookings(200)
    today = todays_bookings()
    with db() as conn:
        loyalty_rows = conn.execute("SELECT * FROM loyalty ORDER BY updated_at DESC LIMIT 200").fetchall()
        message_count = conn.execute(
            "SELECT COUNT(DISTINCT phone) AS conversations FROM message_log"
        ).fetchone()["conversations"] or 0
        campaigns_count = conn.execute(
            "SELECT COUNT(*) AS campaigns FROM bookings WHERE review_requested = 1").fetchone()["campaigns"] or 0
    total_points = sum(int(row["total_points"]) for row in loyalty_rows)
    total_revenue = sum(
        float(b.get("bill_amount") or 0) for b in bookings if b.get("status") == "visited"
    )
    visited_bookings = [b for b in bookings if b.get("status") == "visited"]
    avg_party_size = round(sum(b["guests"] for b in bookings) / len(bookings), 1) if bookings else 0
    today_iso = now_local().date().isoformat()
    capacity_today = capacity_snapshot(today_iso)
    waitlist_open = sum(1 for w in list_waitlist(200) if w["status"] == "waiting")
    return {
        "restaurant": RESTAURANT_NAME,
        "tagline": knowledge.RESTAURANT_PROFILE["tagline"],
        "bookings_total": len(bookings),
        "bookings_today": len(today),
        "loyalty_customers": len(loyalty_rows),
        "loyalty_points_total": total_points,
        "conversations": int(message_count),
        "active_campaigns": int(campaigns_count),
        "total_revenue": round(total_revenue, 2),
        "avg_party_size": avg_party_size,
        "review_delay_hours": REVIEW_DELAY_HOURS,
        "threshold": LOYALTY_THRESHOLD,
        "reward_pct": LOYALTY_REWARD_PCT,
        "whatsapp_number_configured": bool(TWILIO_WHATSAPP_NUMBER),
        "twilio_sender": TWILIO_WHATSAPP_NUMBER,
        "google_place_id_configured": bool(GOOGLE_PLACE_ID or GOOGLE_REVIEW_FALLBACK_URL),
        "google_rating": GOOGLE_RATING or None,
        "restaurant_phone_configured": bool(RESTAURANT_PHONE),
        "seating_capacity": SEATING_CAPACITY,
        "buffet_duration_minutes": BUFFET_DURATION_MINUTES,
        "capacity_today": capacity_today,
        "waitlist_open": waitlist_open,
        "halal_certified": True,
        "ai_concierge_enabled": bool(client),
    }


@app.get("/api/menu")
def api_menu() -> dict:
    return knowledge.menu_summary()


@app.get("/api/capacity")
def api_capacity(date: Optional[str] = None) -> dict:
    target_date = normalize_date(date) if date else now_local().date().isoformat()
    return {"date": target_date, "sessions": capacity_snapshot(target_date)}


@app.post("/api/waitlist")
def api_add_waitlist(payload: WaitlistCreate) -> dict:
    return add_waitlist_entry(
        payload.guest_name, payload.phone, normalize_date(payload.date), payload.session, payload.guests, payload.notes
    )


@app.get("/api/waitlist")
def api_list_waitlist(limit: int = 100) -> list[dict]:
    return list_waitlist(limit)


@app.get("/api/tables")
def api_list_tables(include_inactive: bool = False) -> list[dict]:
    return list_tables(include_inactive)


@app.post("/api/tables")
def api_create_table(payload: TableCreate) -> dict:
    return create_table(payload)


@app.put("/api/tables/{table_id}")
def api_update_table(table_id: str, payload: TableUpdate) -> dict:
    return update_table(table_id, payload)


@app.post("/api/bookings/{booking_id}/assign-table")
def api_assign_table(booking_id: str, payload: TableAssignRequest) -> dict:
    return assign_table_to_booking(booking_id, payload.table_id)


# ============================================================================
# PHONE VOICE AGENT
# Inbound/outbound calls over Twilio Media Streams, live-transcribed with
# Deepgram Nova-3 (STT) and spoken with Deepgram Aura-2 (TTS). Call transfer
# uses Twilio's own call-redirect API rather than a homegrown bridge, since
# that's the reliable path that avoids the lag/drop failure mode.
# ============================================================================

def _build_deepgram_stt_url() -> str:
    # Keyterm boosting: raises recognition accuracy for brand/menu vocabulary that generic
    # STT tends to mishear (e.g. "halal" was transcribed as "alone" in testing before this was added).
    keyterms = ["halal", "JING", "hotpot", "buffet", "mala", "Sichuan", "Tanjong Katong", "KINEX"]
    keyterms += [item["name"] for item in knowledge.SOUP_BASES]
    keyterms += [item["name"] for item in knowledge.PROTEINS_AND_SPECIALTIES]
    keyterm_params = "&".join(f"keyterm={quote(term)}" for term in keyterms)
    return (
        "wss://api.deepgram.com/v1/listen"
        f"?model={DEEPGRAM_MODEL}&encoding=mulaw&sample_rate=8000&channels=1"
        "&punctuate=true&smart_format=true&interim_results=true"
        f"&endpointing=300&utterance_end_ms=1200&vad_events=true&language=en&{keyterm_params}"
    )


DEEPGRAM_STT_URL = _build_deepgram_stt_url()


def voice_diagnostics() -> dict:
    trial_account: Optional[bool] = None
    transfer_number_verified: Optional[bool] = None
    transfer_warning: Optional[str] = None
    voice_number_owned: Optional[bool] = None

    tw_client = twilio_client()
    if tw_client and TWILIO_ACCOUNT_SID:
        try:
            account = tw_client.api.accounts(TWILIO_ACCOUNT_SID).fetch()
            trial_account = account.type == "Trial"
        except Exception as exc:  # noqa: BLE001
            transfer_warning = f"Could not check Twilio account type: {exc}"

        if TWILIO_VOICE_NUMBER:
            try:
                owned = tw_client.incoming_phone_numbers.list(phone_number=TWILIO_VOICE_NUMBER)
                voice_number_owned = bool(owned) and bool(owned[0].capabilities.get("voice"))
            except Exception:  # noqa: BLE001
                voice_number_owned = None

        if trial_account and STAFF_TRANSFER_NUMBER:
            try:
                verified = tw_client.outgoing_caller_ids.list()
                transfer_number_verified = any(v.phone_number == STAFF_TRANSFER_NUMBER for v in verified)
                if not transfer_number_verified:
                    transfer_warning = (
                        f"This is a Twilio Trial account, and {STAFF_TRANSFER_NUMBER} is not a verified "
                        "Caller ID on it — call transfer will fail until the account is upgraded or that "
                        "number is verified in the Twilio console."
                    )
            except Exception as exc:  # noqa: BLE001
                transfer_warning = f"Could not check verified caller IDs: {exc}"

    transfer_ready = bool(STAFF_TRANSFER_NUMBER) and (transfer_number_verified is not False)

    return {
        "deepgram_configured": bool(DEEPGRAM_API_KEY),
        "stt_model": DEEPGRAM_MODEL,
        "tts_model": DEEPGRAM_TTS_MODEL,
        "tts_voices_available": AURA_VOICES,
        "voice_llm_model": VOICE_GROQ_MODEL,
        "twilio_voice_number": TWILIO_VOICE_NUMBER or None,
        "twilio_voice_number_owned": voice_number_owned,
        "staff_transfer_number": STAFF_TRANSFER_NUMBER or None,
        "public_base_url": PUBLIC_BASE_URL or None,
        "trial_account": trial_account,
        "ready_for_calls": bool(
            DEEPGRAM_API_KEY and TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
            and TWILIO_VOICE_NUMBER and PUBLIC_BASE_URL
        ),
        "transfer_ready": transfer_ready,
        "transfer_warning": transfer_warning,
        "missing": [
            name for name, value in [
                ("TWILIO_VOICE_NUMBER", TWILIO_VOICE_NUMBER),
                ("STAFF_TRANSFER_NUMBER", STAFF_TRANSFER_NUMBER),
                ("PUBLIC_BASE_URL", PUBLIC_BASE_URL),
            ] if not value
        ],
    }


VOICE_TRANSFER_TOOL = {
    "type": "function",
    "function": {
        "name": "transfer_to_staff",
        "description": (
            "Transfer the caller to a staff member. Use this when the caller explicitly asks for a human, "
            "has a complex request the tools here can't handle (large group, event booking, complaint), "
            "or sounds frustrated or confused by the automated assistant."
        ),
        "parameters": {
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "Short reason for the transfer."}},
            "required": ["reason"],
        },
    },
}
# notify_staff is deliberately excluded from voice: transfer_to_staff already sends the same
# WhatsApp notification automatically (see execute_call_transfer), and giving the model two
# similar tools to choose from on a call risks it picking the one that doesn't actually connect
# the caller — then claiming a transfer happened when it didn't.
VOICE_TOOLS = [tool for tool in AGENT_TOOLS if tool["function"]["name"] != "notify_staff"] + [VOICE_TRANSFER_TOOL]


_LEAKED_FUNCTION_TAG = re.compile(r"<function=\w+>.*?(?=$|<function=)", re.DOTALL)


def _strip_leaked_function_syntax(text: str) -> str:
    """Remove raw tool-call syntax the model occasionally leaks into spoken/text content.

    Verified in testing: Groq's fast model sometimes emits '<function=name>{...}' as
    literal text instead of a structured tool call. Left in, that would be read aloud
    or shown to the guest verbatim.
    """
    cleaned = _LEAKED_FUNCTION_TAG.sub("", text).strip()
    return cleaned or text.strip()


_TRANSFER_INTENT_PHRASES = (
    "transfer", "transferring", "connect you", "connecting you", "put you through",
    "get someone", "get a staff", "hand you over", "pass you to",
)


def _mentions_transfer_intent(reply_text: str) -> bool:
    """Catch the model narrating a transfer in speech without actually calling the tool.

    Fast models occasionally do this — verified in testing where the model said
    'I'm going to transfer you to a staff member now' with no tool call at all.
    Since we can't rely on prompting alone to prevent it, if the reply promises a
    transfer, we honor that promise for real rather than leave the caller stranded.
    """
    lowered = reply_text.lower()
    return any(phrase in lowered for phrase in _TRANSFER_INTENT_PHRASES)


def _build_voice_system_prompt(phone: str, outbound_purpose: Optional[str]) -> str:
    today = now_local()
    outbound_block = (
        f"""
This call was placed BY the restaurant TO this person. The greeting has already been spoken (see conversation history) \
— do NOT re-introduce yourself or repeat why you're calling. The reason for this call: {outbound_purpose}.
Pick up from where the greeting left off: respond to what the person just said and guide the conversation toward \
{outbound_purpose} (e.g. confirming interest, proposing next steps, or collecting booking details) — warm and \
conversational, not pushy. Once the purpose has been addressed, answer questions normally.
"""
        if outbound_purpose
        else ""
    )
    return f"""
You are the phone host for {RESTAURANT_NAME}, a halal Chinese hotpot & grill buffet in Singapore.
Today is {today.strftime('%A, %Y-%m-%d')}. The caller's phone number is already known ({phone}) — never ask for it.
You are speaking on a live phone call, not chatting on text. Talk like a warm, genuinely friendly host who
loves this restaurant — not like a script being read out.
{outbound_block}
Rules for spoken responses:
- Sound like a real person on the phone: use natural warmth ("Of course!", "Happy to help with that", "Great choice!"),
  react to what the caller says instead of just answering flatly, and let a bit of enthusiasm for the food come through.
- Be interactive, not just a Q&A machine — ask a natural follow-up when it fits ("Any occasion we should know about?",
  "Would you like a spicier mala or something milder?") instead of only answering exactly what was asked.
- Plain spoken sentences only. No markdown, no bullet points, no numbered lists, no emoji.
- Keep replies conversational-length — usually 1-3 sentences, like an actual phone call, not a monologue and not a
  curt one-liner either. Warmth can take a few extra words; don't pad with filler that doesn't add anything.
- Callers may speak Singlish or mix in local phrasing — respond naturally and don't comment on their accent or phrasing.
- If you mishear something or aren't confident what was said, ask a short clarifying question instead of guessing.

{knowledge.voice_prompt_block()}

Guidelines:
- Never invent menu items, prices, or hours — only use the facts above.
- Use tools for anything involving real bookings, availability, loyalty points, or the review link.
- Before calling create_reservation, confirm guest name, date, time, and party size out loud, and get a clear yes.
- If you already confirmed this exact booking earlier in the call, do not call create_reservation again.
- Call transfer_to_staff if the caller asks for a person, has a request you can't handle, or seems frustrated.
- For group bookings, private events, or large parties: call transfer_to_staff (this also automatically texts staff the caller's number as a backup) and tell the caller you're connecting them now.
- Never read a URL aloud. If the caller wants the menu, a review link, or a social media page, use the send_link tool to text it to them and say something like "I've just sent that to your WhatsApp."
- Never claim you did something you didn't. Only say you're transferring the call if you actually called transfer_to_staff this turn; only say you sent a link if you actually called send_link this turn.
""".strip()


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _consume_voice_stream(stream, sentence_queue: "queue.Queue") -> tuple[str, dict]:
    """Iterate one streaming chat completion. Plain-text deltas are sentence-split and
    pushed onto sentence_queue as soon as each sentence completes, so speak_stream_turn
    can start TTS on sentence 1 before the model has even written sentence 2. Tool-call
    deltas are accumulated (a function call can't be split into speech — it must arrive
    whole before it can be executed) and returned instead, since a tool-calling round
    never produces speakable content on its own."""
    content_buffer = ""
    sentence_buffer = ""
    tool_call_fragments: dict[int, dict] = {}
    for chunk in stream:
        delta = chunk.choices[0].delta
        if getattr(delta, "tool_calls", None):
            for tc_delta in delta.tool_calls:
                frag = tool_call_fragments.setdefault(tc_delta.index, {"id": "", "name": "", "arguments": ""})
                if tc_delta.id:
                    frag["id"] = tc_delta.id
                if tc_delta.function and tc_delta.function.name:
                    frag["name"] += tc_delta.function.name
                if tc_delta.function and tc_delta.function.arguments:
                    frag["arguments"] += tc_delta.function.arguments
        if getattr(delta, "content", None):
            content_buffer += delta.content
            sentence_buffer += delta.content
            parts = _SENTENCE_SPLIT_RE.split(sentence_buffer)
            if len(parts) > 1:
                for complete in parts[:-1]:
                    complete = complete.strip()
                    if complete and not tool_call_fragments:
                        sentence_queue.put(complete)
                sentence_buffer = parts[-1]

    if not tool_call_fragments:
        remaining = sentence_buffer.strip()
        if remaining:
            sentence_queue.put(remaining)
    return content_buffer, tool_call_fragments


def stream_voice_agent_turn(
    phone: str,
    text: str,
    history: list[dict],
    outbound_purpose: Optional[str],
    sentence_queue: "queue.Queue",
    result_holder: dict,
) -> None:
    """Blocking — run via asyncio.to_thread. Resolves any tool calls the same way the
    old non-streaming version did (round-trip, execute, loop), since a function call
    can't be spoken; only the final plain-text reply streams sentence-by-sentence into
    sentence_queue as it's generated. Always ends by putting None onto the queue, and
    fills result_holder with the full reply text and should_transfer for history/logging."""
    system_prompt = _build_voice_system_prompt(phone, outbound_purpose)
    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": text}]
    should_transfer = False

    def _give_up(reply: str) -> None:
        result_holder["reply"] = reply
        result_holder["should_transfer"] = should_transfer
        sentence_queue.put(reply)
        sentence_queue.put(None)

    for _ in range(4):
        try:
            stream = voice_client.chat.completions.create(
                model=VOICE_GROQ_MODEL,
                messages=messages,
                tools=VOICE_TOOLS,
                tool_choice="auto",
                temperature=0.4,
                max_tokens=150,
                stream=True,
            )
            content_buffer, tool_call_fragments = _consume_voice_stream(stream, sentence_queue)
        except Exception as exc:  # noqa: BLE001 - retry once, the fast voice model occasionally emits a malformed tool call
            logger.warning("Voice completion stream failed, retrying once: %s", exc)
            try:
                stream = voice_client.chat.completions.create(
                    model=VOICE_GROQ_MODEL,
                    messages=messages,
                    tools=VOICE_TOOLS,
                    tool_choice="auto",
                    temperature=0.4,
                    max_tokens=150,
                    stream=True,
                )
                content_buffer, tool_call_fragments = _consume_voice_stream(stream, sentence_queue)
            except Exception as retry_exc:  # noqa: BLE001
                logger.warning("Voice completion stream failed again, giving up this turn: %s", retry_exc)
                _give_up("Sorry, I'm having a little trouble on my end — give me just a moment and try again?")
                return

        if tool_call_fragments:
            ordered_calls = [tool_call_fragments[i] for i in sorted(tool_call_fragments)]
            messages.append({
                "role": "assistant",
                "content": content_buffer or "",
                "tool_calls": [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
                    for c in ordered_calls
                ],
            })
            for call in ordered_calls:
                try:
                    args = json.loads(call["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                if call["name"] == "transfer_to_staff":
                    should_transfer = True
                    result = {"status": "transfer_ready" if STAFF_TRANSFER_NUMBER else "transfer_unavailable"}
                else:
                    try:
                        result = execute_tool_call(call["name"], args, phone)
                    except Exception as exc:  # noqa: BLE001
                        result = {"error": str(exc)}
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"] or call["name"],
                    "content": json.dumps(result, default=str),
                })
            continue

        reply = _strip_leaked_function_syntax(content_buffer.strip() or "Sorry, could you say that again?")
        if not should_transfer and _mentions_transfer_intent(reply) and STAFF_TRANSFER_NUMBER:
            should_transfer = True
        result_holder["reply"] = reply
        result_holder["should_transfer"] = should_transfer
        sentence_queue.put(None)
        return

    fallback = "I'm having trouble with that right now." if not should_transfer else "Let me connect you with our team now."
    _give_up(fallback)


_NUMBER_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
]
_NUMBER_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def _int_to_words(n: int) -> str:
    if n < 20:
        return _NUMBER_ONES[n]
    if n < 100:
        tens, rem = divmod(n, 10)
        return _NUMBER_TENS[tens] + (f" {_NUMBER_ONES[rem]}" if rem else "")
    if n < 1000:
        hundreds, rem = divmod(n, 100)
        return f"{_NUMBER_ONES[hundreds]} hundred" + (f" {_int_to_words(rem)}" if rem else "")
    if n < 1_000_000:
        thousands, rem = divmod(n, 1000)
        return f"{_int_to_words(thousands)} thousand" + (f" {_int_to_words(rem)}" if rem else "")
    return str(n)


_CURRENCY_RE = re.compile(r"S?\$\s?(\d[\d,]*)(?:\.(\d{2}))?")
_TIME_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s?([APap]\.?[Mm]\.?)\b")


def _currency_to_words(match: "re.Match") -> str:
    dollars = int(match.group(1).replace(",", ""))
    cents = match.group(2)
    words = f"{_int_to_words(dollars)} dollar" + ("" if dollars == 1 else "s")
    if cents and int(cents) > 0:
        cents_val = int(cents)
        words += f" and {_int_to_words(cents_val)} cent" + ("" if cents_val == 1 else "s")
    return words


def _time_to_words(match: "re.Match") -> str:
    hour = int(match.group(1))
    minute = match.group(2)
    meridiem = match.group(3).upper().replace(".", "")
    hour_words = _int_to_words(hour)
    if minute and int(minute) > 0:
        minute_val = int(minute)
        minute_words = f"oh {_NUMBER_ONES[minute_val]}" if minute_val < 10 else _int_to_words(minute_val)
        return f"{hour_words} {minute_words} {meridiem}"
    return f"{hour_words} {meridiem}"


def normalize_for_tts(text: str) -> str:
    """Rewrite currency and clock-time patterns into words TTS pronounces naturally
    (e.g. "$150" -> "one hundred fifty dollars", "3pm" -> "three PM")."""
    text = _CURRENCY_RE.sub(_currency_to_words, text)
    text = _TIME_RE.sub(_time_to_words, text)
    return text


async def deepgram_tts(text: str) -> bytes:
    async with httpx.AsyncClient(timeout=20.0) as http_client:
        response = await http_client.post(
            f"https://api.deepgram.com/v1/speak?model={DEEPGRAM_TTS_MODEL}&encoding=mulaw&sample_rate=8000",
            headers={"Authorization": f"Token {DEEPGRAM_API_KEY}", "Content-Type": "application/json"},
            json={"text": normalize_for_tts(text)},
        )
        response.raise_for_status()
        return response.content


async def presynthesize_greeting() -> None:
    """Synthesize the fixed inbound greeting once at startup so the first caller of the
    day doesn't pay for a live TTS round-trip before hearing anything."""
    global _presynthesized_greeting_audio
    if not DEEPGRAM_API_KEY:
        return
    try:
        _presynthesized_greeting_audio = await deepgram_tts(INBOUND_GREETING_TEXT)
        logger.info("Pre-synthesized inbound greeting audio at startup (%d bytes)", len(_presynthesized_greeting_audio))
    except Exception as exc:  # noqa: BLE001 - falls back to live synthesis per-call
        logger.warning("Could not pre-synthesize greeting at startup, will synthesize live: %s", exc)


# asyncio only holds a weak reference to a task started via create_task — without
# keeping a strong reference somewhere, a fire-and-forget task can be garbage-collected
# mid-run. This set exists purely to keep background tasks (like post-call analysis)
# alive until they finish, then drops them via the done callback.
_background_tasks: set = set()


def _fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def analyze_call_transcript(call_state: dict) -> None:
    """Post-call: ask the LLM to extract structured booking details from the transcript
    and store them for later review (e.g. a future daily digest). Best-effort — must
    never raise, since this runs after the call has already ended."""
    history = call_state.get("history") or []
    if len(history) <= 1 or not voice_client:
        # Only the greeting was said (or nothing at all) - no real conversation to extract.
        return

    transcript_text = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history)
    extraction_prompt = f"""
Extract booking details from this restaurant phone call transcript. Respond with ONLY a JSON object,
no other text, using exactly this shape:
{{"guest_name": string or null, "date": string or null, "time": string or null, "party_size": number or null,
"special_requests": string or null, "booking_confirmed": boolean, "summary": string}}
Use null for anything not mentioned. "summary" is one short sentence describing the outcome of the call.

Transcript:
{transcript_text}
""".strip()

    try:
        completion = await asyncio.to_thread(
            voice_client.chat.completions.create,
            model=VOICE_GROQ_MODEL,
            messages=[{"role": "user", "content": extraction_prompt}],
            temperature=0.1,
            max_tokens=200,
        )
        raw = (completion.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        extracted = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Post-call analysis failed for %s: %s", call_state.get("phone"), exc)
        return

    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO call_analysis (id, call_sid, phone, direction, extracted_json, transcript, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    str(uuid.uuid4()),
                    call_state.get("call_sid"),
                    call_state.get("phone"),
                    "outbound" if call_state.get("outbound") else "inbound",
                    json.dumps(extracted),
                    transcript_text,
                    now_iso(),
                ),
            )
        logger.info("Post-call analysis stored for %s: %s", call_state.get("phone"), extracted.get("summary"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not store post-call analysis for %s: %s", call_state.get("phone"), exc)


async def send_audio_to_twilio(ws: WebSocket, stream_sid: str, audio_bytes: bytes, mark_name: str) -> None:
    chunk_size = 640  # ~80ms of mulaw @ 8kHz per frame
    for i in range(0, len(audio_bytes), chunk_size):
        payload = base64.b64encode(audio_bytes[i:i + chunk_size]).decode("ascii")
        await ws.send_text(json.dumps({"event": "media", "streamSid": stream_sid, "media": {"payload": payload}}))
    await ws.send_text(json.dumps({"event": "mark", "streamSid": stream_sid, "mark": {"name": mark_name}}))


async def clear_twilio_playback(ws: WebSocket, stream_sid: str) -> None:
    try:
        await ws.send_text(json.dumps({"event": "clear", "streamSid": stream_sid}))
    except Exception:  # noqa: BLE001
        pass


# Callers reflexively say "hello?" the instant they pick up, before they've heard
# anything from us — that overlaps the very start of our own greeting/reply. Without
# this grace window, that reflexive word triggers real barge-in and cancels audio
# that was never actually given a chance to play, and since the caller still hasn't
# heard anything they say "hello?" again, repeatedly cancelling every attempt.
BARGE_IN_GRACE_SECONDS = 1.2

# Reflexive check-ins ("hello?", "are you there?") said while our own reply is still
# within the grace window shouldn't restart the turn — the caller is just checking the
# line is live, not saying something new. A real reply to an actual question ("yes",
# "50 people", "Friday") must still go through immediately, so this list stays narrow.
_FILLER_TRANSCRIPTS = {
    "hello", "hi", "hey", "hello hello", "anybody there",
    "are you there", "can you hear me", "who is this",
}


def _is_filler_transcript(text: str) -> bool:
    return text.strip().lower().rstrip("?.!").strip() in _FILLER_TRANSCRIPTS


async def cancel_current_speech(ws: WebSocket, call_state: dict) -> None:
    speaking = call_state.get("speaking")
    if speaking:
        speaking["active"] = False
    speak_task = call_state.get("speak_task")
    if speak_task and not speak_task.done():
        speak_task.cancel()
        await clear_twilio_playback(ws, call_state["stream_sid"])
        try:
            await speak_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


def execute_call_transfer(call_sid: str, caller_phone: str) -> None:
    # Send a WhatsApp safety-net notification with the caller's contact — the live
    # transfer below may not connect (no answer, or blocked by trial-account
    # restrictions), so staff still get a written note either way.
    notify_staff_via_whatsapp(caller_phone, "Call transfer requested during a phone call.")

    response = VoiceResponse()
    response.dial(STAFF_TRANSFER_NUMBER)
    tw_client = twilio_client()
    if tw_client:
        tw_client.calls(call_sid).update(twiml=str(response))


async def speak_turn(ws: WebSocket, call_state: dict, text: str, should_transfer: bool, speaking_task_holder: dict) -> None:
    stream_sid = call_state["stream_sid"]
    call_sid = call_state["call_sid"]
    caller_phone = call_state["phone"]
    mark_name = f"reply-{uuid.uuid4().hex[:8]}"
    try:
        if text == INBOUND_GREETING_TEXT and _presynthesized_greeting_audio:
            audio_bytes = _presynthesized_greeting_audio
        else:
            audio_bytes = await deepgram_tts(text)
        call_state["awaited_mark"] = mark_name
        call_state["mark_event"].clear()
        await send_audio_to_twilio(ws, stream_sid, audio_bytes, mark_name=mark_name)
        # Twilio plays the audio out in real time over the call, which takes far longer
        # than handing the bytes to the socket does. Without waiting for Twilio's own
        # "mark" ack that playback actually finished, we'd flip speaking_task_holder off
        # the instant we're done sending, and any speech Deepgram picks up while the reply
        # is still audibly playing (even the caller's own "hello?") triggers barge-in and
        # clears the in-flight audio before the caller ever hears it.
        try:
            await asyncio.wait_for(call_state["mark_event"].wait(), timeout=15.0)
        except asyncio.TimeoutError:
            pass
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("TTS/send failed for call %s: %s", call_sid, exc)
    finally:
        speaking_task_holder["active"] = False

    if should_transfer and STAFF_TRANSFER_NUMBER:
        await asyncio.sleep(0.3)
        await asyncio.to_thread(execute_call_transfer, call_sid, caller_phone)


async def speak_stream_turn(
    ws: WebSocket,
    call_state: dict,
    sentence_queue: "queue.Queue",
    speaking_task_holder: dict,
    result_holder: dict,
) -> None:
    """Consumes sentences as stream_voice_agent_turn generates them, pipelining TTS
    synthesis for the next sentence with playback of the current one so the gap between
    sentences is close to zero instead of a full TTS round-trip each time."""
    stream_sid = call_state["stream_sid"]
    call_sid = call_state["call_sid"]
    caller_phone = call_state["phone"]
    live_tasks: list[asyncio.Task] = []

    def spawn(coro):
        task = asyncio.create_task(coro)
        live_tasks.append(task)
        return task

    try:
        current_text = await spawn(asyncio.to_thread(sentence_queue.get))
        current_audio_task = spawn(deepgram_tts(current_text)) if current_text else None

        while current_text is not None:
            audio_bytes = await current_audio_task
            mark_name = f"reply-{uuid.uuid4().hex[:8]}"
            call_state["awaited_mark"] = mark_name
            call_state["mark_event"].clear()
            await send_audio_to_twilio(ws, stream_sid, audio_bytes, mark_name=mark_name)

            # Fetch and start synthesizing the NEXT sentence concurrently with waiting
            # for this one to finish playing, so its audio is ready (or nearly) the
            # instant this sentence's mark ack arrives.
            next_text_task = spawn(asyncio.to_thread(sentence_queue.get))
            mark_wait_task = spawn(asyncio.wait_for(call_state["mark_event"].wait(), timeout=15.0))

            next_text = await next_text_task
            next_audio_task = spawn(deepgram_tts(next_text)) if next_text else None

            try:
                await mark_wait_task
            except asyncio.TimeoutError:
                pass

            current_text = next_text
            current_audio_task = next_audio_task
    except asyncio.CancelledError:
        for t in live_tasks:
            if not t.done():
                t.cancel()
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("Streaming TTS/send failed for call %s: %s", call_sid, exc)
    finally:
        speaking_task_holder["active"] = False

    if result_holder.get("should_transfer") and STAFF_TRANSFER_NUMBER:
        await asyncio.sleep(0.3)
        await asyncio.to_thread(execute_call_transfer, call_sid, caller_phone)


async def handle_voice_turn(ws: WebSocket, call_state: dict, transcript: str) -> None:
    phone = call_state["phone"]
    history = call_state["history"]
    insert_message(phone, "in", f"[call] {transcript}")

    # A finalized transcript means the caller genuinely said something real, so any
    # still-playing prior reply is now stale — cancel it outright regardless of the
    # barge-in grace window (that window only debounces the early VAD trigger, it
    # doesn't apply once we actually have real content to respond to).
    await cancel_current_speech(ws, call_state)

    sentence_queue: "queue.Queue" = queue.Queue()
    result_holder: dict = {}
    llm_task = asyncio.create_task(
        asyncio.to_thread(
            stream_voice_agent_turn,
            phone,
            transcript,
            history,
            call_state.get("purpose") if call_state.get("outbound") else None,
            sentence_queue,
            result_holder,
        )
    )

    speaking_state = {"active": True}
    call_state["speaking"] = speaking_state
    call_state["speak_started_at"] = time.monotonic()
    call_state["speak_task"] = asyncio.create_task(
        speak_stream_turn(ws, call_state, sentence_queue, speaking_state, result_holder)
    )

    try:
        await llm_task
    except Exception as exc:  # noqa: BLE001 - a live call must never go silent, no matter what breaks upstream
        logger.warning("Voice turn failed entirely for %s: %s", phone, exc)

    reply_text = result_holder.get("reply", "Sorry, could you say that again?")
    insert_message(phone, "out", f"[call] {reply_text}")
    history.append({"role": "user", "content": transcript})
    history.append({"role": "assistant", "content": reply_text})
    call_state["history"] = history[-10:]


async def pump_deepgram_transcripts(deepgram_ws, ws: WebSocket, call_state: dict) -> None:
    buffer_parts: list[str] = []
    async for raw_message in deepgram_ws:
        try:
            event = json.loads(raw_message)
        except json.JSONDecodeError:
            continue

        event_type = event.get("type")

        if event_type == "SpeechStarted":
            speaking = call_state.get("speaking")
            if speaking and speaking.get("active"):
                elapsed = time.monotonic() - call_state.get("speak_started_at", 0.0)
                if elapsed >= BARGE_IN_GRACE_SECONDS:
                    await cancel_current_speech(ws, call_state)
            continue

        if event_type != "Results":
            continue

        alternatives = event.get("channel", {}).get("alternatives", [])
        transcript = alternatives[0].get("transcript", "").strip() if alternatives else ""
        if not transcript:
            continue

        if event.get("is_final"):
            buffer_parts.append(transcript)

        if event.get("speech_final") and buffer_parts:
            full_transcript = " ".join(buffer_parts).strip()
            buffer_parts.clear()
            if not full_transcript:
                continue

            speaking = call_state.get("speaking")
            still_in_grace = (
                time.monotonic() - call_state.get("speak_started_at", 0.0) < BARGE_IN_GRACE_SECONDS
            )
            if speaking and speaking.get("active") and still_in_grace and _is_filler_transcript(full_transcript):
                # The caller is just checking the line is live, not saying something new -
                # let the in-flight greeting/reply keep playing uninterrupted.
                continue

            await handle_voice_turn(ws, call_state, full_transcript)


@app.post("/webhook/voice")
def webhook_voice(From: str = Form(...), CallSid: str = Form(...), _signature_ok: None = Depends(verify_twilio_request)) -> Response:
    if not PUBLIC_BASE_URL:
        response = VoiceResponse()
        response.say("Sorry, the phone assistant isn't fully configured yet. Please call back later.")
        return Response(content=str(response), media_type="application/xml")

    ws_base = PUBLIC_BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    response = VoiceResponse()
    connect = response.connect()
    stream = connect.stream(url=f"{ws_base}/media-stream")
    stream.parameter(name="phone", value=From)
    stream.parameter(name="greeting", value=INBOUND_GREETING_TEXT)
    return Response(content=str(response), media_type="application/xml")


@app.post("/webhook/voice-outbound")
def webhook_voice_outbound(
    guest_name: str = "Guest",
    purpose: str = "a reservation follow-up",
    To: str = Form(...),
    _signature_ok: None = Depends(verify_twilio_request),
) -> Response:
    if not PUBLIC_BASE_URL:
        response = VoiceResponse()
        response.say("Sorry, the phone assistant isn't fully configured yet.")
        return Response(content=str(response), media_type="application/xml")

    ws_base = PUBLIC_BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    response = VoiceResponse()
    connect = response.connect()
    stream = connect.stream(url=f"{ws_base}/media-stream")
    stream.parameter(name="phone", value=To)
    stream.parameter(name="purpose", value=purpose)
    stream.parameter(name="outbound", value="true")
    stream.parameter(
        name="greeting",
        value=f"Hi {guest_name}, this is {RESTAURANT_NAME} calling about {purpose}. Is now a good time to talk?",
    )
    return Response(content=str(response), media_type="application/xml")


@app.websocket("/media-stream")
async def media_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    call_state = {
        "phone": "unknown",
        "call_sid": None,
        "stream_sid": None,
        "history": [],
        "speaking": None,
        "speak_task": None,
        "mark_event": asyncio.Event(),
        "awaited_mark": None,
        "speak_started_at": 0.0,
    }
    deepgram_ws = None
    pump_task = None

    try:
        deepgram_ws = await websockets.connect(
            DEEPGRAM_STT_URL, extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"}
        )

        while True:
            raw = await websocket.receive_text()
            event = json.loads(raw)
            kind = event.get("event")

            if kind == "start":
                start = event.get("start", {})
                call_state["call_sid"] = start.get("callSid")
                call_state["stream_sid"] = start.get("streamSid")
                params = start.get("customParameters", {}) or {}
                call_state["phone"] = params.get("phone", "unknown")
                call_state["outbound"] = params.get("outbound") == "true"
                call_state["purpose"] = params.get("purpose")
                greeting = params.get("greeting") or INBOUND_GREETING_TEXT

                pump_task = asyncio.create_task(pump_deepgram_transcripts(deepgram_ws, websocket, call_state))

                # Record the greeting so the LLM won't re-introduce itself on the first turn.
                call_state["history"].append({"role": "assistant", "content": greeting})

                speaking_state = {"active": True}
                call_state["speaking"] = speaking_state
                call_state["speak_started_at"] = time.monotonic()
                call_state["speak_task"] = asyncio.create_task(
                    speak_turn(websocket, call_state, greeting, False, speaking_state)
                )

            elif kind == "media":
                payload = event.get("media", {}).get("payload")
                if payload and deepgram_ws:
                    await deepgram_ws.send(base64.b64decode(payload))

            elif kind == "mark":
                mark_name = event.get("mark", {}).get("name")
                if mark_name and mark_name == call_state.get("awaited_mark"):
                    call_state["mark_event"].set()

            elif kind == "stop":
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("media-stream error: %s", exc)
    finally:
        if pump_task:
            pump_task.cancel()
        if deepgram_ws:
            await deepgram_ws.close()
        _fire_and_forget(analyze_call_transcript(call_state))


class OutboundCallRequest(BaseModel):
    phone: str
    guest_name: str = "Guest"
    purpose: str = "a reservation follow-up"


@app.post("/api/voice/call-out")
def api_voice_call_out(payload: OutboundCallRequest) -> dict:
    diagnostics = voice_diagnostics()
    if not diagnostics["ready_for_calls"]:
        raise HTTPException(
            status_code=400,
            detail=f"Voice agent isn't fully configured yet. Missing: {', '.join(diagnostics['missing']) or 'Twilio/Deepgram credentials'}.",
        )
    tw_client = twilio_client()
    call = tw_client.calls.create(
        to=payload.phone,
        from_=TWILIO_VOICE_NUMBER,
        url=(
            f"{PUBLIC_BASE_URL}/webhook/voice-outbound"
            f"?guest_name={quote(payload.guest_name)}&purpose={quote(payload.purpose)}"
        ),
    )
    record_campaign("outbound_call", payload.phone, payload.guest_name, "calling", f"Outbound call: {payload.purpose}")
    return {"status": "calling", "call_sid": call.sid, "phone": payload.phone}


@app.get("/api/diagnostics/voice")
def api_voice_diagnostics() -> dict:
    return voice_diagnostics()
