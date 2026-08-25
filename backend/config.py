import os

SECRET_KEY = os.environ.get("MARKETPLACE_SECRET_KEY", "")
IS_DEV = os.environ.get("MARKETPLACE_DEV", "") == "1"
if not SECRET_KEY:
    if IS_DEV:
        # local development only
        SECRET_KEY = "dev-only-insecure-key"
    else:
        raise RuntimeError(
            "MARKETPLACE_SECRET_KEY is not set. Generate one with:\n"
            "  python3 -c \"import secrets; print(secrets.token_hex(32))\"\n"
            "and export it, or set MARKETPLACE_DEV=1 for local development."
        )
ALGORITHM = "HS256"

# Sessions last a week; override with MARKETPLACE_TOKEN_EXPIRE_MINUTES.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("MARKETPLACE_TOKEN_EXPIRE_MINUTES", 60 * 24 * 7))

# Comma-separated allowed frontend origins, e.g. "http://localhost:5500,https://mysite.com"
ALLOWED_ORIGINS = os.environ.get("MARKETPLACE_ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",")

# Public base URL, no trailing slash. Used wherever an absolute URL is
# required: Open Graph tags, sitemap entries, links inside emails.
SITE_URL = os.environ.get("MARKETPLACE_SITE_URL", "https://btumarket.ge")

# Postgres in production; falls back to local SQLite so a fresh clone runs
# with zero setup.
DATABASE_URL = os.environ.get("MARKETPLACE_DATABASE_URL", "sqlite:///./marketplace.db")

# Backs the rate limiter, dedupe caches, and the RQ email queue. The default
# hostname resolves inside the Compose network; running bare (no Docker)
# leaves Redis unreachable, which is fine - every Redis-backed check fails
# open (see auth.py).
REDIS_URL = os.environ.get("MARKETPLACE_REDIS_URL", "redis://redis:6379/0")

# Where the static frontend is served from, relative to backend/. The Docker
# image bakes the build into a different relative path and overrides this
# (see docker-compose.yml).
FRONTEND_DIR = os.environ.get("MARKETPLACE_FRONTEND_DIR", os.path.join("..", "frontend", "dist"))

# ---------- Student verification ----------
# Comma-separated email domains allowed to register, e.g. "btu.edu.ge".
# Empty (the default) = anyone can register, for development.
ALLOWED_EMAIL_DOMAINS = [
    d.strip().lower()
    for d in os.environ.get("MARKETPLACE_ALLOWED_EMAIL_DOMAINS", "").split(",")
    if d.strip()
]
# ---------- Email sending ----------
# With SMTP_HOST unset, verification codes are printed to the console instead
# of emailed, so the whole flow works locally with zero setup.
SMTP_HOST = os.environ.get("MARKETPLACE_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("MARKETPLACE_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("MARKETPLACE_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("MARKETPLACE_SMTP_PASSWORD", "")
FROM_EMAIL = os.environ.get("MARKETPLACE_FROM_EMAIL", SMTP_USER or "BTU Market <noreply@btumarket.local>")

# "0" skips email verification (accounts become active instantly).
REQUIRE_EMAIL_VERIFICATION = os.environ.get("MARKETPLACE_REQUIRE_EMAIL_VERIFICATION", "1") == "1"
# ---------- Google Sign-In ----------
# OAuth Client ID ("Web application") from Google Cloud Console. Client IDs
# are public by design. Empty = the button doesn't render.
GOOGLE_CLIENT_ID = os.environ.get("MARKETPLACE_GOOGLE_CLIENT_ID", "")

# ---------- Error tracking ----------
# Sentry DSN; empty = Sentry never initializes. DSNs are public identifiers,
# not credentials.
SENTRY_DSN = os.environ.get("MARKETPLACE_SENTRY_DSN", "")

# ---------- Admins ----------
# Comma-separated usernames with moderation powers, e.g. MARKETPLACE_ADMINS="giorgi".
ADMIN_USERNAMES = {
    u.strip().lower()
    for u in os.environ.get("MARKETPLACE_ADMINS", "").split(",")
    if u.strip()
}
