from __future__ import annotations

import json
import os
import sqlite3
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Form, HTTPException, Request
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
from openai import OpenAI
from twilio.rest import Client as TwilioClient
from twilio.twiml.messaging_response import MessagingResponse
import httpx

load_dotenv()

APP_DIR = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./restaurant_agent.db")
DB_PATH = Path(DATABASE_URL.replace("sqlite:///", ""))
RESTAURANT_NAME = os.getenv("RESTAURANT_NAME", "Your Restaurant")
RESTAURANT_PHONE = os.getenv("RESTAURANT_PHONE", "")
GOOGLE_PLACE_ID = os.getenv("GOOGLE_PLACE_ID", "")
REVIEW_DELAY_HOURS = int(os.getenv("REVIEW_DELAY_HOURS", "2"))
LOYALTY_THRESHOLD = int(os.getenv("LOYALTY_THRESHOLD", "500"))
LOYALTY_REWARD_PCT = int(os.getenv("LOYALTY_REWARD_PCT", "20"))
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
scheduler = BackgroundScheduler(timezone=LOCAL_TZ)
scheduler.start()
LAST_TWILIO_ERROR: Optional[str] = None
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI(title="Restaurant Retail AI Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


app.add_middleware(CacheControlMiddleware)
app.mount("/assets", StaticFiles(directory=APP_DIR), name="assets")


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


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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
                no_show INTEGER NOT NULL DEFAULT 0
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


@app.on_event("startup")
def startup() -> None:
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
            "SELECT * FROM bookings WHERE phone = ? AND date >= ? ORDER BY date ASC, time ASC LIMIT ?",
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


def process_whatsapp_text(phone: str, text: str) -> str:
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
        insert_message(phone, "out", response_text)
        return response_text

    if intent == "greeting":
        response_text = (
            f"Hi there! Welcome to {RESTAURANT_NAME}. "
            "I can help you book a table, check your upcoming bookings, view loyalty points, or request a review link. What would you like to do?"
        )
    elif intent == "help":
        response_text = (
            "Here's what I can help with:\n"
            "• Book a table — just say 'Book a table'\n"
            "• Check your upcoming bookings — say 'My bookings'\n"
            "• View loyalty points and vouchers — say 'Loyalty points'\n"
            "• Request a review link — say 'Leave a review'\n"
            "Reply with CANCEL at any time to stop a booking."
        )
    elif intent == "book":
        session = start_booking_session(phone)
        response_text = session_message("name")
    elif intent == "bookings":
        bookings = get_upcoming_bookings(phone)
        response_text = format_booking_list(bookings)
    elif intent == "loyalty":
        loyalty = get_loyalty(phone, "Guest")
        vouchers = f" Voucher code: {loyalty['last_voucher_code']}." if loyalty.get("last_voucher_code") else ""
        response_text = (
            f"Hi {loyalty['guest_name']}, you have {loyalty['total_points']} loyalty points "
            f"across {loyalty['visit_count']} visit(s).{vouchers} "
            f"Reach {LOYALTY_THRESHOLD} points to unlock a {LOYALTY_REWARD_PCT}% reward."
        )
    elif intent == "review":
        review_link = f"https://search.google.com/local/writereview?placeid={GOOGLE_PLACE_ID}" if GOOGLE_PLACE_ID else ""
        link_text = f" Click here: {review_link}" if review_link else ""
        response_text = (
            f"Thank you for dining at {RESTAURANT_NAME}! We'd love your feedback.{link_text} "
            "Reply BOOK if you'd also like to make a new reservation."
        )
    else:
        response_text = (
            f"Thanks for contacting {RESTAURANT_NAME}. "
            "I can help with bookings, loyalty points, reviews, and more. Say HELP for options or BOOK to reserve a table."
        )

    insert_message(phone, "out", response_text)
    return response_text


def insert_message(phone: str, direction: str, message: str) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO message_log (id, phone, direction, message, created_at) VALUES (?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), phone, direction, message, now_iso()),
        )


def get_session(phone: str) -> Optional[dict]:
    with db() as conn:
        row = conn.execute("SELECT * FROM whatsapp_sessions WHERE phone = ?", (phone,)).fetchone()
        return dict(row) if row else None


def save_session(session: WhatsAppBookingSession) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO whatsapp_sessions (phone, stage, guest_name, date, time, guests, special_requests, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        conn.execute("DELETE FROM whatsapp_sessions WHERE phone = ?", (phone,))


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
        booking = create_booking(payload)
        delete_session(session["phone"])
        return (
            f"Booking confirmed for {booking['guest_name']} on {booking['date']} at {booking['time']}. "
            f"We have scheduled reminders and saved the booking.",
            None,
        )

    delete_session(session["phone"])
    return session_message("name"), start_booking_session(session["phone"])


def create_booking(payload: BookingCreate) -> dict:
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
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
    confirmation_text = (
        f"Booking confirmed at {RESTAURANT_NAME}. "
        f"Date: {booking['date']} Time: {booking['time']} Guests: {booking['guests']}."
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
    send_whatsapp_message(
        booking["phone"],
        confirmation_text,
        content_sid=TWILIO_CONFIRMATION_CONTENT_SID or None,
        content_variables={
            "1": booking["guest_name"],
            "2": RESTAURANT_NAME,
            "3": booking["date"],
            "4": booking["time"],
            "5": str(booking["guests"]),
        } if TWILIO_CONFIRMATION_CONTENT_SID else None,
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
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Booking not found")
        return dict(row)


def list_bookings(limit: int = 50) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bookings ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def todays_bookings() -> list[dict]:
    today = now_local().date().isoformat()
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM bookings WHERE date = ? ORDER BY time ASC",
            (today,),
        ).fetchall()
        return [dict(row) for row in rows]


def mark_visited(booking_id: str, bill_amount: float) -> dict:
    booking = get_booking(booking_id)
    visited_at = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE bookings SET status = ?, visited_at = ?, bill_amount = ? WHERE id = ?",
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
            "UPDATE bookings SET status = ?, no_show = 1 WHERE id = ?",
            ("no_show", booking_id),
        )
    booking["status"] = "no_show"
    booking["no_show"] = 1
    return booking


def get_loyalty(phone: str, guest_name: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM loyalty WHERE phone = ?", (phone,)).fetchone()
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            "UPDATE bookings SET review_requested = 1, review_requested_at = ? WHERE id = ?",
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
    review_link = f"https://search.google.com/local/writereview?placeid={GOOGLE_PLACE_ID}" if GOOGLE_PLACE_ID else ""
    link_text = f" {review_link}" if review_link else ""
    return (
        f"Hi {guest_name}, thank you for visiting {RESTAURANT_NAME}. "
        f"We would love your feedback on {platform}.{link_text}"
        " If you enjoyed your experience, please leave us a quick review."
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            "SELECT * FROM campaigns ORDER BY sent_at DESC LIMIT ?",
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
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
            "SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_review_response(review_id: str, draft_response: str) -> dict:
    responded_at = now_iso()
    with db() as conn:
        conn.execute(
            "UPDATE reviews SET draft_response = ?, responded_at = ? WHERE id = ?",
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
    booking = create_booking(payload)
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
            "SELECT * FROM loyalty ORDER BY updated_at DESC LIMIT ?",
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
            "SELECT COUNT(*) AS campaigns FROM bookings WHERE review_requested = 1"
        ).fetchone()["campaigns"] or 0
    total_points = sum(int(row["total_points"]) for row in loyalty_rows)
    total_revenue = sum(
        float(b.get("bill_amount") or 0) for b in bookings if b.get("status") == "visited"
    )
    return {
        "restaurant": RESTAURANT_NAME,
        "bookings_total": len(bookings),
        "bookings_today": len(today),
        "loyalty_customers": len(loyalty_rows),
        "loyalty_points_total": total_points,
        "conversations": int(message_count),
        "active_campaigns": int(campaigns_count),
        "total_revenue": round(total_revenue, 2),
        "review_delay_hours": REVIEW_DELAY_HOURS,
        "threshold": LOYALTY_THRESHOLD,
        "reward_pct": LOYALTY_REWARD_PCT,
        "whatsapp_number_configured": bool(TWILIO_WHATSAPP_NUMBER),
        "twilio_sender": TWILIO_WHATSAPP_NUMBER,
        "google_place_id_configured": bool(GOOGLE_PLACE_ID),
        "restaurant_phone_configured": bool(RESTAURANT_PHONE),
    }
