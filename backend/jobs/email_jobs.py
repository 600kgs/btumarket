"""RQ job functions. Separate module so the worker can import them without
pulling in the FastAPI app; RQ resolves jobs by import path, which must be
identical in the web and worker processes.
"""
from emailer import send_email


def send_email_job(to: str, subject: str, body: str) -> bool:
    return send_email(to, subject, body)
