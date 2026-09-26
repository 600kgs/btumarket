"""Admin moderation: approval queue, report queue, user list, ban/unban,
delete user."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import (
    Block,
    Event,
    Favorite,
    Listing,
    Message,
    Notification,
    Photo,
    Report,
    SavedSearch,
    get_db,
)
from datetime import datetime, timedelta

from models import User
from services import (
    get_photos_map,
    is_admin,
    notify_saved_searches,
    remove_photo_files,
    require_admin,
)

router = APIRouter()


@router.get("/admin/pending")
def list_pending(username: str = Depends(require_admin), db: Session = Depends(get_db)):
    """Listings from first-time sellers, waiting to be made public."""
    listings = (
        db.query(Listing)
        .filter(Listing.status == "pending")
        .order_by(Listing.created_at.asc())
        .all()
    )
    photos = get_photos_map(db, [l.id for l in listings])
    return {
        "pending": [
            {
                "id": l.id,
                "title": l.title,
                "description": l.description,
                "price": l.price,
                "category": l.category,
                "seller": l.seller,
                "created_at": l.created_at,
                "photos": photos.get(l.id, []),
            }
            for l in listings
        ]
    }


@router.post("/admin/listings/{listing_id}/approve")
def approve_listing(listing_id: int, username: str = Depends(require_admin), db: Session = Depends(get_db)):
    """Make a reviewed listing public. Saved-search alerts fire now rather
    than at creation, so nobody is pointed at a listing they can't open."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="listing_not_found")
    if listing.status != "pending":
        return {"message": "Already reviewed"}
    listing.status = "available"
    # published now, so it should sort as new rather than as when it was
    # submitted
    listing.created_at = datetime.utcnow()
    db.commit()
    notify_saved_searches(db, listing)
    return {"message": "Listing approved"}


@router.get("/admin/reports")
def list_reports(username: str = Depends(require_admin), db: Session = Depends(get_db)):
    reports = (
        db.query(Report)
        .filter(Report.status == "open")
        .order_by(Report.created_at.desc())
        .all()
    )
    listing_ids = {r.listing_id for r in reports}
    listings = {}
    if listing_ids:
        for l in db.query(Listing).filter(Listing.id.in_(listing_ids)).all():
            listings[l.id] = l
    return {
        "reports": [
            {
                "id": r.id,
                "listing_id": r.listing_id,
                "listing_title": listings[r.listing_id].title if r.listing_id in listings else None,
                "listing_seller": listings[r.listing_id].seller if r.listing_id in listings else None,
                "reporter": r.reporter,
                "reason": r.reason,
                "created_at": r.created_at,
            }
            for r in reports
        ]
    }


@router.post("/admin/reports/{report_id}/dismiss")
def dismiss_report(report_id: int, username: str = Depends(require_admin), db: Session = Depends(get_db)):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = "resolved"
    db.commit()
    return {"message": "Report dismissed"}


@router.get("/admin/users")
def list_users(q: str = "", username: str = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(User)
    if q:
        like = f"%{q}%"
        # ilike for the same Postgres case-sensitivity reason as /search.
        query = query.filter(or_(User.username.ilike(like), User.email.ilike(like)))

    users = query.order_by(User.id.desc()).all()
    listing_counts = dict(
        db.query(Listing.seller, func.count(Listing.id)).group_by(Listing.seller).all()
    )
    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "email_verified": bool(u.email_verified),
                "is_admin": is_admin(u.username),
                "is_banned": bool(u.is_banned),
                "listing_count": listing_counts.get(u.username, 0),
                "created_at": u.created_at,
            }
            for u in users
        ]
    }


@router.post("/admin/users/{target_username}/ban")
def ban_user(target_username: str, username: str = Depends(require_admin), db: Session = Depends(get_db)):
    target_username = target_username.strip().lower()

    if target_username == username:
        raise HTTPException(status_code=400, detail="You can't ban your own account")
    if is_admin(target_username):
        raise HTTPException(status_code=400, detail="Remove them from MARKETPLACE_ADMINS first")

    user = db.query(User).filter(func.lower(User.username) == target_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_banned = 1
    db.commit()
    return {"message": f"{target_username} banned"}


@router.post("/admin/users/{target_username}/unban")
def unban_user(target_username: str, username: str = Depends(require_admin), db: Session = Depends(get_db)):
    target_username = target_username.strip().lower()

    user = db.query(User).filter(func.lower(User.username) == target_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_banned = 0
    db.commit()
    return {"message": f"{target_username} unbanned"}


@router.delete("/admin/users/{target_username}")
def delete_user(target_username: str, username: str = Depends(require_admin), db: Session = Depends(get_db)):
    target_username = target_username.strip().lower()

    if target_username == username:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    if is_admin(target_username):
        raise HTTPException(status_code=400, detail="Remove them from MARKETPLACE_ADMINS first")

    user = db.query(User).filter(func.lower(User.username) == target_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Manual cascade, kept in sync with /me/delete-account. Reports stay as
    # a historical record; the admin UI tolerates a missing listing/user.
    listing_ids = [l.id for l in db.query(Listing.id).filter(Listing.seller == user.username).all()]
    if listing_ids:
        for photo in db.query(Photo).filter(Photo.listing_id.in_(listing_ids)).all():
            remove_photo_files(photo.file_path)
        db.query(Photo).filter(Photo.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Favorite).filter(Favorite.listing_id.in_(listing_ids)).delete(synchronize_session=False)
        db.query(Listing).filter(Listing.id.in_(listing_ids)).delete(synchronize_session=False)

    db.query(Message).filter(
        or_(Message.sender == user.username, Message.recipient == user.username)
    ).delete(synchronize_session=False)
    db.query(Favorite).filter(Favorite.username == user.username).delete(synchronize_session=False)
    db.query(Block).filter(
        or_(Block.username == user.username, Block.blocked_username == user.username)
    ).delete(synchronize_session=False)
    db.query(SavedSearch).filter(SavedSearch.username == user.username).delete(synchronize_session=False)
    db.query(Notification).filter(
        or_(Notification.username == user.username, Notification.actor == user.username)
    ).delete(synchronize_session=False)

    db.delete(user)
    db.commit()
    return {"message": f"Deleted {target_username} and their listings/messages"}


@router.get("/admin/stats")
def admin_stats(days: int = 30, _: str = Depends(require_admin), db: Session = Depends(get_db)):
    """The funnel, as counts over a window.

    Deliberately computed on read rather than kept as running totals: the
    volumes here are small, and a query that can be re-run is worth more than
    a counter that can drift out of step with the events behind it.
    """
    days = min(max(days, 1), 365)
    since = datetime.utcnow() - timedelta(days=days)

    counts = dict(
        db.query(Event.name, func.count(Event.id))
        .filter(Event.created_at >= since)
        .group_by(Event.name)
        .all()
    )

    started = counts.get("register_started", 0)
    verified = counts.get("register_verified", 0)

    # what people looked for and did not find, most common first - the
    # shortlist of what the marketplace is missing
    empty = (
        db.query(Event.detail, func.count(Event.id).label("n"))
        .filter(Event.name == "search_empty", Event.created_at >= since, Event.detail != "")
        .group_by(Event.detail)
        .order_by(func.count(Event.id).desc())
        .limit(25)
        .all()
    )

    return {
        "window_days": days,
        "counts": counts,
        "register_completion_pct": round(verified / started * 100, 1) if started else None,
        "empty_searches": [{"query": q, "count": n} for q, n in empty],
    }
