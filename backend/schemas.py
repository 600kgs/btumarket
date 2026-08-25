"""Pydantic request bodies. Credentials travel in bodies, never query
params, to keep them out of server logs and browser history."""
import re

from pydantic import BaseModel, EmailStr, Field, field_validator


def normalize_georgian_phone(v: str) -> str:
    """Format check only: accepts a Georgian mobile number (5XXXXXXXX,
    optionally with +995/995 and separators) and normalizes to bare digits.
    Empty passes through - phone is optional, chat is the primary contact
    channel."""
    if not v:
        return ""
    digits = re.sub(r"[\s\-()]", "", v)
    digits = re.sub(r"^\+?995", "", digits)
    if not re.fullmatch(r"5\d{8}", digits):
        raise ValueError("Enter a valid Georgian mobile number, e.g. 555 12 34 56.")
    return digits


# Must stay in sync with CATEGORIES in frontend/src/lib/utils.ts. The column
# is a plain string; this validator is what keeps arbitrary values out.
ALLOWED_CATEGORIES = {
    "textbooks",
    "notes",
    "electronics",
    "clothes",
    "dorm",
    "bikes",
    "sports",
    "tickets",
    "services",
    "other",
}


class RegisterRequest(BaseModel):
    email: EmailStr
    phone: str = Field(default="", max_length=30)
    password: str = Field(min_length=8)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return normalize_georgian_phone(v)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class ChangePhoneRequest(BaseModel):
    phone: str = Field(default="", max_length=30)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return normalize_georgian_phone(v)


class DeleteAccountRequest(BaseModel):
    password: str


class SavedSearchRequest(BaseModel):
    query: str = Field(default="", max_length=100)
    category: str = ""

    @field_validator("category")
    @classmethod
    def category_known_or_empty(cls, v: str) -> str:
        if v and v not in ALLOWED_CATEGORIES:
            raise ValueError("Unknown category")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str   # signed ID token from Google Identity Services


class ListingRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    # 100,000 GEL ceiling keeps junk prices out of the database
    price: float = Field(ge=0, le=100_000)
    category: str

    @field_validator("category")
    @classmethod
    def category_must_be_known(cls, v: str) -> str:
        if v not in ALLOWED_CATEGORIES:
            raise ValueError("Unknown category")
        return v
    # One random value per page load of the Post form. The server replays the
    # created listing for any repeat submission carrying the same token
    # instead of creating a duplicate.
    client_token: str | None = None


class MessageRequest(BaseModel):
    listing_id: int
    recipient: str
    body: str = Field(min_length=1, max_length=2000)


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str


class EmailOnlyRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str = Field(min_length=8)


class ReportRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
