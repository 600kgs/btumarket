from database import Base
from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    phone = Column(String)
    password = Column(String)
    # 1 = verified; new registrations start at 0 and confirm an emailed code
    email_verified = Column(Integer, default=1)
    # 1 = banned; enforced per-request in auth, not just at login
    is_banned = Column(Integer, default=0)
    # set on password change/reset; tokens issued before it are rejected
    password_changed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
