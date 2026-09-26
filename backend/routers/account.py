"""Account settings: password/phone/delete, blocking, saved searches, the bell."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import check_rate_limit, hash_password, record_attempt, require_user, verify_password
from database import (
    Block,
    EmailCode,
    Favorite,
    Listing,
    Message,
    Notification,
    Photo,
    Report,
    SavedSearch,
    get_db,
)
from models import User
from schemas import (
    ChangePasswordRequest,
    ChangePhoneRequest,
    DeleteAccountRequest,
    SavedSearchRequest,
)
from services import (
    LOGIN_LOCKOUT_SECONDS,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_SECONDS,
    MAX_SAVED_SEARCHES,
    remove_photo_files,
)

logger = logging.getLogger("btumarket")

router = APIRouter()


@router.post("/me/change-password")
def change_password(body: ChangePasswordRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    # same throttle as /login: to someone holding a stolen session, the
    # current_password check is otherwise an unlimited password-guess oracle
    key = f"change_password:{username}"
    check_rate_limit(key)
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(body.current_password, user.password):
        record_attempt(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)
        raise HTTPException(status_code=403, detail="current_password_incorrect")
    user.password = hash_password(body.new_password)
    # invalidates every existing token, including this request's; the
    # frontend routes back to login
    user.password_changed_at = datetime.utcnow()
    db.commit()
    return {"message": "Password changed"}


@router.patch("/me/phone")
def change_phone(body: ChangePhoneRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="user_not_found")
    user.phone = body.phone
    db.commit()
    return {"message": "Phone updated", "phone": user.phone}


@router.post("/me/delete-account")
def delete_account(body: DeleteAccountRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    """Full account deletion: the user row and everything referencing it.
    Password re-entry guards against a stolen session deleting the account;
    the throttle guards the password check itself."""
    key = f"delete_account:{username}"
    check_rate_limit(key)
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(body.password, user.password):
        record_attempt(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)
        raise HTTPException(status_code=403, detail="password_incorrect")

    # no FK constraints in this schema; child rows are cleaned up manually,
    # photo files included
    listing_ids = [l.id for l in db.query(Listing.id).filter(Listing.seller == username).all()]
    if listing_ids:
        for photo in db.query(Photo).filter(Photo.listing_id.in_(listing_ids)).all():
            remove_photo_files(photo.file_path)
        db.query(Photo).filter(Photo.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Favorite).filter(Favorite.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Report).filter(Report.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Message).filter(Message.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Listing).filter(Listing.id.in_(listing_ids)).delete(synchronize_session=False)

    db.query(Message).filter(or_(Message.sender == username, Message.recipient == username)).delete(synchronize_session=False)
    db.query(Favorite).filter(Favorite.username == username).delete(synchronize_session=False)
    db.query(Report).filter(Report.reporter == username).delete(synchronize_session=False)
    db.query(Block).filter(or_(Block.username == username, Block.blocked_username == username)).delete(synchronize_session=False)
    db.query(SavedSearch).filter(SavedSearch.username == username).delete(synchronize_session=False)
    db.query(Notification).filter(or_(Notification.username == username, Notification.actor == username)).delete(synchronize_session=False)
    db.query(EmailCode).filter(EmailCode.email == user.email).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    logger.info("Account deleted: %s (%d listings removed)", username, len(listing_ids))
    return {"message": "Account deleted"}


@router.post("/users/{target}/block")
def block_user(target: str, username: str = Depends(require_user), db: Session = Depends(get_db)):
    if target == username:
        raise HTTPException(status_code=400, detail="cant_block_self")
    if not db.query(User).filter(User.username == target).first():
        raise HTTPException(status_code=404, detail="user_not_found")
    existing = db.query(Block).filter(Block.username == username, Block.blocked_username == target).first()
    if not existing:
        db.add(Block(username=username, blocked_username=target))
        db.commit()
    return {"blocked": True}


@router.delete("/users/{target}/block")
def unblock_user(target: str, username: str = Depends(require_user), db: Session = Depends(get_db)):
    db.query(Block).filter(Block.username == username, Block.blocked_username == target).delete()
    db.commit()
    return {"blocked": False}


@router.get("/me/blocks")
def my_blocks(username: str = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.query(Block).filter(Block.username == username).order_by(Block.created_at.desc()).all()
    return {"blocked": [r.blocked_username for r in rows]}


@router.get("/me/saved-searches")
def list_saved_searches(username: str = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.query(SavedSearch).filter(SavedSearch.username == username).order_by(SavedSearch.created_at.desc()).all()
    return {"saved": [{"id": r.id, "query": r.query, "category": r.category} for r in rows]}


@router.post("/me/saved-searches")
def create_saved_search(body: SavedSearchRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    q = body.query.strip()
    if not q and not body.category:
        raise HTTPException(status_code=400, detail="saved_search_empty")
    count = db.query(SavedSearch).filter(SavedSearch.username == username).count()
    if count >= MAX_SAVED_SEARCHES:
        raise HTTPException(status_code=400, detail={"code": "saved_search_limit", "limit": MAX_SAVED_SEARCHES})
    dup = db.query(SavedSearch).filter(
        SavedSearch.username == username, SavedSearch.query == q, SavedSearch.category == body.category
    ).first()
    if dup:
        return {"id": dup.id, "message": "Already saved"}
    row = SavedSearch(username=username, query=q, category=body.category)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "message": "Saved"}


@router.delete("/me/saved-searches/{search_id}")
def delete_saved_search(search_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    db.query(SavedSearch).filter(SavedSearch.id == search_id, SavedSearch.username == username).delete()
    db.commit()
    return {"message": "Deleted"}


@router.get("/notifications")
def list_notifications(username: str = Depends(require_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Notification)
        .filter(Notification.username == username)
        .order_by(Notification.created_at.desc())
        .limit(30)
        .all()
    )
    unread = db.query(Notification).filter(Notification.username == username, Notification.is_read == 0).count()
    return {
        "unread": unread,
        "notifications": [
            {"id": n.id, "type": n.type, "listing_id": n.listing_id, "actor": n.actor,
             "is_read": n.is_read, "created_at": n.created_at}
            for n in rows
        ],
    }


@router.post("/notifications/read-all")
def mark_notifications_read(username: str = Depends(require_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.username == username, Notification.is_read == 0).update({"is_read": 1})
    db.commit()
    return {"message": "ok"}
