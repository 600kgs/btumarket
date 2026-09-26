"""Registration, login, Google sign-in, email verification, password reset."""
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from google.oauth2 import id_token as google_id_token
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from auth import (
    check_rate_limit,
    clear_attempts,
    create_access_token,
    hash_password,
    record_attempt,
    verify_password,
)
from config import ALLOWED_EMAIL_DOMAINS, GOOGLE_CLIENT_ID, REQUIRE_EMAIL_VERIFICATION
from database import get_db
from models import User
from schemas import (
    EmailOnlyRequest,
    GoogleAuthRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    VerifyEmailRequest,
)
from services import (
    GOOGLE_REQUEST,
    LOGIN_LOCKOUT_SECONDS,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_SECONDS,
    REGISTER_LOCKOUT_SECONDS,
    REGISTER_MAX_ATTEMPTS,
    REGISTER_WINDOW_SECONDS,
    client_ip,
    consume_code,
    issue_code,
    send_reset_email,
    send_verification_email,
    track,
    username_from_email_local,
    username_from_google_profile,
)

router = APIRouter()


@router.post("/register")
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    # throttle by IP; every call counts since account spam is the threat
    key = f"register:{client_ip(request)}"
    check_rate_limit(key)
    record_attempt(key, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_SECONDS, REGISTER_LOCKOUT_SECONDS)

    # students-only gate when ALLOWED_EMAIL_DOMAINS is configured
    if ALLOWED_EMAIL_DOMAINS:
        domain = body.email.split("@")[-1].lower()
        if domain not in ALLOWED_EMAIL_DOMAINS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "email_domain_restricted",
                    "domains": ", ".join("@" + d for d in ALLOWED_EMAIL_DOMAINS),
                },
            )

    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="email_taken")

    username = username_from_email_local(db, body.email)

    user = User(
        username=username,
        email=body.email,
        phone=body.phone,
        password=hash_password(body.password),
        email_verified=0 if REQUIRE_EMAIL_VERIFICATION else 1,
    )
    db.add(user)
    track(db, "register_started", username)
    db.commit()

    if REQUIRE_EMAIL_VERIFICATION:
        code = issue_code(db, body.email, "verify")
        send_verification_email(body.email, code)
        return {"message": "Registered. Check your email for a verification code.", "verification_required": True, "username": username}

    # no email step (dev mode): log them straight in
    token = create_access_token({"sub": username})
    return {"message": "User registered successfully", "verification_required": False, "username": username, "access_token": token, "token_type": "bearer"}


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # keyed by IP + username: caps brute-forcing one account without locking
    # out everyone sharing a campus NAT
    key = f"login:{client_ip(request)}:{body.username.lower()}"
    check_rate_limit(key)

    login_id = body.username.strip().lower()
    user = db.query(User).filter(
        or_(func.lower(User.username) == login_id, func.lower(User.email) == login_id)
    ).first()
    if not user or not verify_password(body.password, user.password):
        record_attempt(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)
        raise HTTPException(status_code=401, detail="invalid_credentials")

    if user.is_banned:
        raise HTTPException(status_code=403, detail="account_banned")

    if REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(status_code=403, detail="email_not_verified")

    clear_attempts(key)
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "username": user.username}


@router.get("/public-config")
def public_config():
    """Non-secret, frontend-safe config values."""
    return {"google_client_id": GOOGLE_CLIENT_ID}


@router.post("/auth/google")
def google_auth(body: GoogleAuthRequest, db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="google_not_configured")

    try:
        idinfo = google_id_token.verify_oauth2_token(body.credential, GOOGLE_REQUEST, GOOGLE_CLIENT_ID)
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid_google_credential")

    email = (idinfo.get("email") or "").lower()
    hd = idinfo.get("hd", "")

    # hd (hosted domain) comes from Google's signed token, not the email
    # string, so it can't be spoofed by a lookalike address
    if ALLOWED_EMAIL_DOMAINS:
        domain = email.split("@")[-1]
        if not idinfo.get("email_verified") or hd not in ALLOWED_EMAIL_DOMAINS or domain not in ALLOWED_EMAIL_DOMAINS:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "google_domain_restricted",
                    "domains": ", ".join("@" + d for d in ALLOWED_EMAIL_DOMAINS),
                },
            )

    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        username = username_from_google_profile(
            db, email, idinfo.get("given_name", ""), idinfo.get("family_name", "")
        )
        user = User(
            username=username,
            email=email,
            phone="",
            # random, never typed anywhere; this account logs in via Google
            # unless a password reset later sets one
            password=hash_password(secrets.token_urlsafe(24)),
            # Google's verified-email + hosted-domain check replaces the
            # emailed code
            email_verified=1,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    if user.is_banned:
        raise HTTPException(status_code=403, detail="account_banned")

    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "username": user.username}


@router.post("/verify-email")
def verify_email(body: VerifyEmailRequest, request: Request, db: Session = Depends(get_db)):
    # throttled: 6-digit codes must not be brute-forceable
    key = f"verifycode:{client_ip(request)}:{body.email.lower()}"
    check_rate_limit(key)

    user = db.query(User).filter(User.email == body.email).first()
    if user and user.email_verified:
        return {"message": "Email already verified"}

    if not user or not consume_code(db, body.email, "verify", body.code):
        record_attempt(key, 8, 15 * 60, 15 * 60)
        raise HTTPException(status_code=400, detail="invalid_or_expired_code")

    user.email_verified = 1
    # the pair register_started / register_verified is the drop-off rate:
    # how many people ask for a code and never come back with it
    track(db, "register_verified", user.username)
    db.commit()
    clear_attempts(key)

    if user.is_banned:
        return {"message": "Email verified"}

    # log them straight in rather than bouncing to the login form
    token = create_access_token({"sub": user.username})
    return {"message": "Email verified", "access_token": token, "token_type": "bearer", "username": user.username}


@router.post("/resend-verification")
def resend_verification(body: EmailOnlyRequest, request: Request, db: Session = Depends(get_db)):
    key = f"resend:{client_ip(request)}:{body.email.lower()}"
    check_rate_limit(key)
    record_attempt(key, 3, 60 * 60, 60 * 60)

    user = db.query(User).filter(User.email == body.email).first()
    if user and not user.email_verified:
        code = issue_code(db, body.email, "verify")
        send_verification_email(body.email, code)

    # same response either way; don't reveal which emails have accounts
    return {"message": "If that email needs verification, a code was sent."}


@router.post("/forgot-password")
def forgot_password(body: EmailOnlyRequest, request: Request, db: Session = Depends(get_db)):
    key = f"forgot:{client_ip(request)}:{body.email.lower()}"
    check_rate_limit(key)
    record_attempt(key, 3, 60 * 60, 60 * 60)

    user = db.query(User).filter(User.email == body.email).first()
    if user:
        code = issue_code(db, body.email, "reset")
        send_reset_email(body.email, code)

    return {"message": "If an account exists with that email, a code was sent."}


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    key = f"resetcode:{client_ip(request)}:{body.email.lower()}"
    check_rate_limit(key)

    user = db.query(User).filter(User.email == body.email).first()
    if not user or not consume_code(db, body.email, "reset", body.code):
        record_attempt(key, 8, 15 * 60, 15 * 60)
        raise HTTPException(status_code=400, detail="invalid_or_expired_code")

    user.password = hash_password(body.new_password)
    # invalidates every token issued before this moment (see auth.py).
    # Whole seconds: JWT iat has second precision.
    user.password_changed_at = datetime.utcnow().replace(microsecond=0)
    db.commit()
    clear_attempts(key)
    return {"message": "Password updated"}
