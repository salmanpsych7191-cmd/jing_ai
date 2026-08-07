from __future__ import annotations

import base64
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

load_dotenv()

APP_DIR = Path(__file__).resolve().parent
DASHBOARD_USERNAME = os.getenv("DASHBOARD_USERNAME", "")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
WEBHOOKS_BASE_URL = os.getenv("WEBHOOKS_BASE_URL", "").rstrip("/")

AUTH_EXEMPT_PREFIXES = ("/health",)

app = FastAPI(title="JING Dashboard")


class DashboardAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith(AUTH_EXEMPT_PREFIXES):
            return await call_next(request)

        if not (DASHBOARD_USERNAME and DASHBOARD_PASSWORD):
            return Response(
                content=(
                    "Dashboard login is not configured. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD "
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


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/") or path == "/" or path == "/index.html":
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app.add_middleware(DashboardAuthMiddleware)
app.add_middleware(CacheControlMiddleware)
app.mount("/assets", StaticFiles(directory=APP_DIR), name="assets")

_HOP_BY_HOP_HEADERS = {"host", "content-length", "connection", "keep-alive", "transfer-encoding"}


async def _proxy(request: Request, target_path: str) -> Response:
    url = f"{WEBHOOKS_BASE_URL}{target_path}"
    body = await request.body()
    forward_headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS}
    async with httpx.AsyncClient(timeout=30.0) as client:
        upstream = await client.request(
            request.method,
            url,
            params=request.query_params,
            content=body,
            headers=forward_headers,
        )
    response_headers = {
        k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "dashboard"}


@app.get("/", response_class=Response)
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


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_api(path: str, request: Request) -> Response:
    return await _proxy(request, f"/api/{path}")


@app.post("/mark-visited")
async def proxy_mark_visited(request: Request) -> Response:
    return await _proxy(request, "/mark-visited")


@app.post("/respond-to-review")
async def proxy_respond_to_review(request: Request) -> Response:
    return await _proxy(request, "/respond-to-review")


@app.get("/todays-bookings")
async def proxy_todays_bookings(request: Request) -> Response:
    return await _proxy(request, "/todays-bookings")
