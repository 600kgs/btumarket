"""Shared helpers, constants, and dependencies used across the routers."""
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request
from google.auth.transport import requests as google_requests
from rq import Queue
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from auth import require_user
from config import ADMIN_USERNAMES, SITE_URL
from database import (
    Block,
    EmailCode,
    Event,
    Favorite,
    Listing,
    Notification,
    Photo,
    SavedSearch,
)
from images import thumb_path_for, webp_path_for
from jobs.email_jobs import send_email_job
from models import User
from redis_client import redis_client, redis_or_none
from translit import fold, query_folds

logger = logging.getLogger("btumarket")

queue = Queue(connection=redis_client)

# reusable transport for verifying Google ID tokens (google-auth caches the keys)
GOOGLE_REQUEST = google_requests.Request()


# ---------- Rate limit settings ----------
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60

REGISTER_MAX_ATTEMPTS = 5
REGISTER_WINDOW_SECONDS = 60 * 60
REGISTER_LOCKOUT_SECONDS = 60 * 60

# Write endpoints throttle by account, not IP: campus wifi puts many users
# behind one NAT address.
LISTING_MAX_ATTEMPTS = 10
LISTING_WINDOW_SECONDS = 60 * 60
LISTING_LOCKOUT_SECONDS = 60 * 60

# Caps how fast one account can harvest sellers' contact details.
CONTACT_MAX_ATTEMPTS = 20
CONTACT_WINDOW_SECONDS = 60 * 60
CONTACT_LOCKOUT_SECONDS = 60 * 60

# Generous enough for a real back-and-forth, low enough to stop mass spam.
MESSAGE_MAX_ATTEMPTS = 100
MESSAGE_WINDOW_SECONDS = 60 * 60
MESSAGE_LOCKOUT_SECONDS = 60 * 60

# (username, client_token) -> listing_id, so re-submitting the same page
# load's form returns the already-created listing instead of a duplicate.
LISTING_DEDUPE_TTL_SECONDS = 24 * 60 * 60

# ---------- Upload constraints ----------
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
# matches the proxy's request_body cap; phone photos routinely exceed 5MB
# and get recompressed server-side anyway
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024

# ---------- Photo limits ----------
MAX_PHOTOS_PER_LISTING = 12

# ---------- Saved searches ----------
MAX_SAVED_SEARCHES = 10
SAVED_SEARCH_EMAIL_COOLDOWN_MINUTES = 60

# ---------- Moderation ----------
# How many approved listings a seller needs before they post without review.
# Counts what they currently have up (sold included, deleted not), so it
# reads as "has a track record" rather than "once passed a check".
TRUSTED_AFTER_APPROVED = 3

# ---------- Listing renewal ----------
BUMP_MIN_AGE_DAYS = 180

# ---------- View counting ----------
# one view per (IP, listing) per window; the seller's own visits don't count
VIEW_DEDUPE_SECONDS = 6 * 60 * 60

CODE_TTL_MINUTES = 15

# At most one "new message" email per recipient per window, however many
# messages arrive in it.
NEW_MESSAGE_EMAIL_COOLDOWN_SECONDS = 15 * 60


SORT_OPTIONS = {
    "newest": Listing.created_at.desc(),
    "oldest": Listing.created_at.asc(),
    "price_low": Listing.price.asc(),
    "price_high": Listing.price.desc(),
    "title_az": Listing.title.asc(),
    "most_viewed": Listing.views.desc(),
}


# ---------- Email ----------

def send_email_async(to: str, subject: str, body: str) -> None:
    """Queue an email job for the RQ worker so requests don't block on SMTP.
    Falls back to sending synchronously if the queue is unreachable - the
    queue exists for speed, losing the email would be worse than a slow
    request."""
    try:
        queue.enqueue(send_email_job, to, subject, body)
    except Exception:
        send_email_job(to, subject, body)


def send_verification_email(email: str, code: str) -> None:
    send_email_async(
        email,
        "BTU Market - verification code",
        f"Your verification code is: {code}\n"
        f"შენი დადასტურების კოდია: {code}\n\n"
        f"The code expires in {CODE_TTL_MINUTES} minutes.",
    )


def send_reset_email(email: str, code: str) -> None:
    send_email_async(
        email,
        "BTU Market - password reset code",
        f"Your password reset code is: {code}\n"
        f"შენი პაროლის აღდგენის კოდია: {code}\n\n"
        f"The code expires in {CODE_TTL_MINUTES} minutes. "
        f"If you didn't request this, you can ignore this email.",
    )


def maybe_send_message_email(recipient: User, sender_username: str, listing_title: str) -> None:
    # Fails CLOSED, unlike the other Redis checks: "already sent recently"
    # and "can't tell" should both mean don't send, otherwise a Redis outage
    # means unlimited notification emails.
    sent = redis_or_none(
        redis_client.set, f"msgcooldown:{recipient.username}", 1,
        ex=NEW_MESSAGE_EMAIL_COOLDOWN_SECONDS, nx=True,
    )
    if not sent:
        return
    send_email_async(
        recipient.email,
        "BTU Market - new message",
        f'{sender_username} sent you a message about "{listing_title}".\n'
        f'{sender_username}-მა შემოგითვალათ შეტყობინება „{listing_title}“-ის შესახებ.\n\n'
        f"Reply here: {SITE_URL}/messages",
    )


# ---------- Verification / reset codes ----------

def issue_code(db: Session, email: str, purpose: str) -> str:
    """Create a fresh 6-digit code for (email, purpose), replacing any old ones."""
    db.query(EmailCode).filter(EmailCode.email == email, EmailCode.purpose == purpose).delete()
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(EmailCode(
        email=email,
        code=code,
        purpose=purpose,
        expires_at=datetime.utcnow() + timedelta(minutes=CODE_TTL_MINUTES),
    ))
    db.commit()
    return code


def consume_code(db: Session, email: str, purpose: str, code: str) -> bool:
    """True and mark used if the code matches, is unused, and hasn't expired."""
    rec = db.query(EmailCode).filter(
        EmailCode.email == email,
        EmailCode.purpose == purpose,
        EmailCode.code == code.strip(),
        EmailCode.used == 0,
        EmailCode.expires_at > datetime.utcnow(),
    ).first()
    if not rec:
        return False
    rec.used = 1
    db.commit()
    return True


# ---------- Misc helpers ----------

def sanitize_filename(filename: str) -> str:
    """Strip path components and unsafe characters, keep the extension."""
    base = os.path.basename(filename or "upload")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return f"{uuid.uuid4().hex}_{base}"


def get_listing_or_404(db: Session, listing_id: int) -> Listing:
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="listing_not_found")
    return listing


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def is_admin(username: str) -> bool:
    return username.lower() in ADMIN_USERNAMES


def remove_photo_files(file_path: str) -> None:
    """Delete all four files a Photo row owns (full + thumb, JPEG + WebP).
    Shared by every delete cascade."""
    for path in (file_path, thumb_path_for(file_path), webp_path_for(file_path), webp_path_for(thumb_path_for(file_path))):
        try:
            os.remove(path)
        except OSError as e:
            logger.warning("Could not remove photo file %s: %s", path, e)


def get_photos_map(db: Session, listing_ids: list) -> dict:
    """Photo paths for many listings in one query, grouped by listing_id,
    oldest first."""
    if not listing_ids:
        return {}
    photos = (
        db.query(Photo)
        .filter(Photo.listing_id.in_(listing_ids))
        .order_by(Photo.id.asc())
        .all()
    )
    photo_map: dict = {}
    for p in photos:
        photo_map.setdefault(p.listing_id, []).append(p.file_path)
    return photo_map


def serialize_listing(listing: Listing, photo_paths=None, favorited: bool = False) -> dict:
    """Listing ORM object -> plain dict. photo_url stays for backwards
    compatibility (it's the first photo)."""
    return {
        "id": listing.id,
        "title": listing.title,
        "description": listing.description,
        "price": listing.price,
        "category": listing.category,
        "status": listing.status,
        "seller": listing.seller,
        "seller_id": listing.seller_id,
        "photo_url": listing.photo_url,
        "photos": photo_paths or [],
        "views": listing.views or 0,
        "is_favorited": favorited,
        "created_at": listing.created_at,
    }


def get_favorited_ids(db: Session, username: str, listing_ids: list) -> set:
    """Which of these listing_ids the user has favorited, if logged in."""
    if not username or not listing_ids:
        return set()
    rows = (
        db.query(Favorite.listing_id)
        .filter(Favorite.username == username, Favorite.listing_id.in_(listing_ids))
        .all()
    )
    return {r[0] for r in rows}


def username_from_email_local(db: Session, email: str) -> str:
    """"Firstname Lastname" derived from the email's local part
    ("giorgi.beridze.1@..." -> "Giorgi Beridze"), matching how university
    addresses are assigned, so students never pick a username. Numeric
    parts are dropped; falls back to the raw local part; appends a number
    if taken."""
    local = email.split("@")[0].lower()
    parts = [p for p in re.split(r"[._-]+", local) if p and not p.isdigit()]
    base = " ".join(p.capitalize() for p in parts[:2]) if parts else re.sub(r"[^a-z0-9]", "", local).capitalize()
    if not base:
        base = "Student"

    username = base
    suffix = 1
    while db.query(User).filter(func.lower(User.username) == username.lower()).first():
        suffix += 1
        username = f"{base}{suffix}"
    return username


def username_from_google_profile(db: Session, email: str, given_name: str, family_name: str) -> str:
    """"Firstname Lastname" from the Google profile, ascii-only; falls back
    to the email's local part; appends a number if taken."""
    cleaned = re.sub(r"[^a-zA-Z0-9 ]", "", f"{given_name} {family_name}")
    base = " ".join(p.capitalize() for p in cleaned.split() if p)
    if not base:
        base = re.sub(r"[^a-z0-9]", "", email.split("@")[0].lower()).capitalize()
    if not base:
        base = "Student"

    username = base
    suffix = 1
    while db.query(User).filter(func.lower(User.username) == username.lower()).first():
        suffix += 1
        username = f"{base}{suffix}"
    return username


def is_blocked_either_way(db: Session, a: str, b: str) -> bool:
    return (
        db.query(Block)
        .filter(or_(
            (Block.username == a) & (Block.blocked_username == b),
            (Block.username == b) & (Block.blocked_username == a),
        ))
        .first()
        is not None
    )


def notify_saved_searches(db: Session, listing: Listing) -> None:
    """Called after a listing is created: alert every matching saved search.
    In-app notification always; email at most once per search per cooldown."""
    matches = db.query(SavedSearch).filter(SavedSearch.username != listing.seller).all()
    now = datetime.utcnow()
    text = f"{listing.title} {listing.description}".lower()
    # cross-script matching, same as /search (see translit.py)
    folded_text = fold(text)
    for s in matches:
        if s.category and s.category != listing.category:
            continue
        if s.query and s.query.lower() not in text and not any(v in folded_text for v in query_folds(s.query)):
            continue
        db.add(Notification(username=s.username, type="saved_search", listing_id=listing.id, actor=listing.seller))
        can_email = s.last_notified_at is None or (now - s.last_notified_at) > timedelta(minutes=SAVED_SEARCH_EMAIL_COOLDOWN_MINUTES)
        if can_email:
            user = db.query(User).filter(User.username == s.username).first()
            if user:
                label = s.query or s.category
                send_email_async(
                    user.email,
                    f"ახალი განცხადება: {listing.title}",
                    f"შენს შენახულ ძიებას ({label}) ახალი განცხადება დაემთხვა:\n\n"
                    f"{listing.title} - {listing.price} ₾\n{SITE_URL}/listing/{listing.id}",
                )
                s.last_notified_at = now
    db.commit()


def require_admin(username: str = Depends(require_user)) -> str:
    if not is_admin(username):
        raise HTTPException(status_code=403, detail="admins_only")
    return username


def track(db: Session, name: str, username: str | None = None, detail: str | None = None) -> None:
    """Record a product event.

    Fails open and never raises: analytics must not be able to break the
    action it is measuring. A registration that works but goes uncounted is a
    far better outcome than a registration that 500s because a write to the
    events table failed.

    The caller owns the commit, so the event lands in the same transaction as
    the thing it describes - no events for actions that later rolled back.
    """
    try:
        db.add(Event(name=name, username=username, detail=(detail or "")[:200]))
    except Exception:
        logger.exception("event tracking failed for %s", name)
