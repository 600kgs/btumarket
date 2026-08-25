import asyncio
import logging
import mimetypes
import os
from contextlib import asynccontextmanager

from logging_config import setup_logging

setup_logging()
logger = logging.getLogger("btumarket")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

import ws_manager
from config import ALLOWED_ORIGINS, FRONTEND_DIR, IS_DEV, SENTRY_DSN
from database import create_tables
from routers import account, admin, auth_routes, listings, messages, pages

if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration

    sentry_sdk.init(dsn=SENTRY_DSN, integrations=[FastApiIntegration()], traces_sample_rate=0.1)
    logger.info("Sentry initialized")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One background task per worker, relaying chat notifications published
    # on any worker to this worker's locally-attached websockets (see
    # ws_manager). The task must be bound to a name that outlives the yield:
    # the event loop holds only a weak reference and will otherwise garbage
    # collect it mid-run.
    subscriber_task = asyncio.create_task(ws_manager.subscriber_loop())
    yield
    subscriber_task.cancel()


# The interactive docs are a development tool. In production they publish the
# full shape of every endpoint - paths, parameters, request and response
# schemas - to anyone who asks, which is a free map for someone probing the
# site. The endpoints are authenticated either way; this removes the map.
app = FastAPI(
    lifespan=lifespan,
    docs_url="/docs" if IS_DEV else None,
    redoc_url="/redoc" if IS_DEV else None,
    openapi_url="/openapi.json" if IS_DEV else None,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # log every unhandled route error; Sentry (when configured) also picks
    # these up via its integration
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Also accept private-LAN origins so the dev site can be opened from a
    # phone on the same network without config changes. Private IPs aren't
    # reachable from the internet; production uses the explicit origin list.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
# python:3.12-slim's mimetypes database is missing both of these; StaticFiles
# would fall back to text/plain
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.middleware("http")
async def no_cache_for_frontend(request: Request, call_next):
    # no-cache forces revalidation (still allows fast 304s) so browsers never
    # keep running a stale copy of the app after a deploy
    response = await call_next(request)
    if request.url.path.startswith("/uploads"):
        # upload filenames are content-unique (uuid per upload), safe to
        # cache forever
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


try:
    create_tables()
except Exception:
    logger.exception("create_tables failed at startup - continuing without it, DB-backed routes will 503")

app.include_router(auth_routes.router)
app.include_router(listings.router)
app.include_router(messages.router)
app.include_router(account.router)
app.include_router(admin.router)
app.include_router(pages.router)


# ---------- Frontend ----------
# The backend serves the built SPA itself: one origin, no CORS in
# production, one deploy.

# First path segments the React app routes (mirrors frontend/src/App.tsx).
# Lets the fallback below distinguish a deep link into the app (200) from a
# URL that exists nowhere (404), so crawlers don't index arbitrary paths as
# duplicates of the homepage. /listing has its own route in routers/pages.py.
APP_ROUTE_SEGMENTS = {
    "products", "post", "messages", "mylistings", "favorites", "admin",
    "login", "register", "verify", "reset", "seller", "settings", "terms",
    "privacy", "how-it-works", "safety", "contact", "index",
}


class SPAStaticFiles(StaticFiles):
    """Serve index.html for any path with no matching file, so a hard
    navigation to a client-side route (refresh, bookmark) still loads the
    app and React Router renders the right page."""

    async def get_response(self, path: str, scope):
        # StaticFiles raises on a missing file rather than returning a 404
        # response object
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = await super().get_response("index.html", scope)
            # legacy .html routes still count as real routes
            first_segment = path.split("/", 1)[0].removesuffix(".html")
            if first_segment not in APP_ROUTE_SEGMENTS:
                response.status_code = 404
            return response


if os.path.isdir(FRONTEND_DIR):
    app.mount("/", SPAStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
