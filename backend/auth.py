import math
from time import time

from jose import JWTError, jwt
from datetime import datetime, timedelta
from passlib.context import CryptContext
from fastapi import HTTPException, Header, Depends
from sqlalchemy.orm import Session
from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from database import get_db
from models import User
from redis_client import redis_client, redis_or_none

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    # iat lets require_user reject tokens issued before a password reset
    to_encode.update({"iat": now, "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode a JWT and return its payload, or raise a 401."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ---------- FastAPI dependencies (Authorization: Bearer <token>) ----------
# No CSRF protection needed: auth is a bearer token set explicitly in JS on
# every request, never a cookie the browser attaches automatically, so a
# cross-site form or <img> has no way to forge an authenticated request.

def _validate_payload_user(payload: dict, db: Session) -> str:
    """Checks shared by every auth path. Raises 401/403."""
    username = payload["sub"]
    user = db.query(User).filter(User.username == username).first()
    # deleted account: the signed token would otherwise stay valid until expiry
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    # checked per-request so a ban applies immediately, not at next login
    if user.is_banned:
        raise HTTPException(status_code=403, detail="account_banned")

    # A password reset invalidates every session issued before it. Tokens
    # predating this feature carry no iat and count as pre-reset.
    if user.password_changed_at:
        issued_at = payload.get("iat")
        if issued_at is None or datetime.utcfromtimestamp(issued_at) < user.password_changed_at:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

    return username


def require_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> str:
    """Dependency: return the logged-in username or raise 401/403."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(authorization[len("Bearer "):])
    return _validate_payload_user(payload, db)


def optional_user(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    """Dependency: username if a valid token was sent, else None. Never raises.

    Applies the same existence/ban/reset checks as require_user; a rejected
    token reads as "not logged in" rather than a working session.
    """
    if not authorization.startswith("Bearer "):
        return None
    try:
        payload = decode_token(authorization[len("Bearer "):])
        return _validate_payload_user(payload, db)
    except HTTPException:
        return None


def username_for_ws_token(token: str, db: Session) -> str:
    """Token validation for the websocket handshake, which receives the token
    in its first message rather than a header."""
    return _validate_payload_user(decode_token(token), db)


# ---------- Rate limiting ----------
# Redis-backed sliding window, shared across workers. Everything here fails
# OPEN: if Redis is slow or unreachable the request goes through, since a
# rate limiter outage should degrade protection, not availability.


def check_rate_limit(key: str) -> None:
    """Raise 429 if this key is currently locked out."""
    remaining = redis_or_none(redis_client.ttl, f"lockout:{key}")
    if remaining and remaining > 0:
        minutes = max(1, math.ceil(remaining / 60))
        raise HTTPException(
            status_code=429,
            detail={"code": "too_many_attempts", "minutes": minutes},
        )


def record_attempt(key: str, max_attempts: int, window_seconds: int, lockout_seconds: int) -> None:
    """Record an attempt; lock the key out once max_attempts is hit within window_seconds.

    A sorted set holds one member per attempt scored by timestamp, so
    ZREMRANGEBYSCORE prunes anything older than the window before ZCARD
    counts what's left (a true sliding window, not a fixed-window counter).
    """
    now = time()
    attempts_key = f"attempts:{key}"

    def _record_and_count():
        pipe = redis_client.pipeline()
        pipe.zadd(attempts_key, {str(now): now})
        pipe.zremrangebyscore(attempts_key, 0, now - window_seconds)
        pipe.zcard(attempts_key)
        return pipe.execute()

    result = redis_or_none(_record_and_count)
    if result is None:
        return
    _, _, count = result

    if count >= max_attempts:
        redis_or_none(redis_client.setex, f"lockout:{key}", lockout_seconds, 1)
        redis_or_none(redis_client.delete, attempts_key)
    else:
        # expire with the window so idle keys clean themselves up
        redis_or_none(redis_client.expire, attempts_key, window_seconds)


def clear_attempts(key: str) -> None:
    redis_or_none(redis_client.delete, f"attempts:{key}", f"lockout:{key}")
