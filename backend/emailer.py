"""Minimal email sender.

Without SMTP configured (the development default), emails are printed to the
console so the verification/reset flows are testable locally. With
MARKETPLACE_SMTP_* set, sends over SMTP+STARTTLS.
"""
import smtplib
from email.message import EmailMessage

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, FROM_EMAIL


def send_email(to: str, subject: str, body: str) -> bool:
    if not SMTP_HOST:
        print(f"\n{'=' * 50}\nEMAIL (dev mode, no SMTP configured)\nTo: {to}\nSubject: {subject}\n\n{body}\n{'=' * 50}\n", flush=True)
        return True

    try:
        msg = EmailMessage()
        msg["From"] = FROM_EMAIL
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001 - log and degrade, never crash a request
        print(f"Email send failed for {to}: {exc}", flush=True)
        return False
