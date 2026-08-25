"""Listings: browse/search, CRUD, photos, favorites, views, sold/renew, reports."""
import math
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import check_rate_limit, optional_user, record_attempt, require_user
from database import Favorite, Listing, Notification, Photo, Report, get_db
from images import process_image, thumb_path_for, webp_path_for
from models import User
from redis_client import redis_client, redis_or_none, try_set_nx
from schemas import ALLOWED_CATEGORIES, ListingRequest, ReportRequest
from translit import fold, query_folds
from services import (
    ALLOWED_IMAGE_TYPES,
    BUMP_MIN_AGE_DAYS,
    CONTACT_LOCKOUT_SECONDS,
    CONTACT_MAX_ATTEMPTS,
    CONTACT_WINDOW_SECONDS,
    LISTING_DEDUPE_TTL_SECONDS,
    LISTING_LOCKOUT_SECONDS,
    LISTING_MAX_ATTEMPTS,
    LISTING_WINDOW_SECONDS,
    MAX_PHOTOS_PER_LISTING,
    MAX_UPLOAD_SIZE_BYTES,
    SORT_OPTIONS,
    TRUSTED_AFTER_APPROVED,
    VIEW_DEDUPE_SECONDS,
    client_ip,
    get_favorited_ids,
    get_listing_or_404,
    get_photos_map,
    is_admin,
    notify_saved_searches,
    remove_photo_files,
    serialize_listing,
    track,
)

router = APIRouter()


@router.get("/listings/{listing_id}")
def get_listing(listing_id: int, viewer=Depends(optional_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)
    # An unreviewed listing isn't public yet; 404 rather than 403 so its
    # existence isn't confirmed to anyone but the seller and the admins.
    if listing.status == "pending" and viewer != listing.seller and not (viewer and is_admin(viewer)):
        raise HTTPException(status_code=404, detail="listing_not_found")
    photos = (
        db.query(Photo)
        .filter(Photo.listing_id == listing_id)
        .order_by(Photo.id.asc())
        .all()
    )
    favorited = listing_id in get_favorited_ids(db, viewer, [listing_id])
    data = serialize_listing(listing, [p.file_path for p in photos], favorited)
    # id+path pairs so the edit page can remove individual photos
    data["photo_items"] = [{"id": p.id, "path": p.file_path} for p in photos]
    return data


@router.get("/search")
def search_listings(
    q: str = "",
    min_price: float = 0,
    max_price: float = 100_000,
    category: str = "",
    sort: str = "newest",
    include_sold: bool = False,
    page: int = 1,
    limit: int = 20,
    viewer=Depends(optional_user),
    db: Session = Depends(get_db),
):
    page = max(page, 1)
    limit = min(max(limit, 1), 100)

    # clamp to the marketplace's price range; swap a reversed range rather
    # than silently returning nothing
    min_price = min(max(min_price, 0), 100_000)
    max_price = min(max(max_price, 0), 100_000)
    if min_price > max_price:
        min_price, max_price = max_price, min_price

    # Match in title or description. ilike, because Postgres LIKE is
    # case-sensitive. The search_fold clauses add cross-script matching:
    # "macbook" finds "მაკბუქი" and vice versa (see translit.py).
    text_match = [Listing.title.ilike(f"%{q}%"), Listing.description.ilike(f"%{q}%")]
    text_match += [Listing.search_fold.like(f"%{v}%") for v in query_folds(q)]
    query = db.query(Listing).filter(
        or_(*text_match),
        Listing.price >= min_price,
        Listing.price <= max_price,
    )
    if not include_sold:
        # sold listings leave the buy-feed; they stay on the seller's own
        # My Listings -> Sold tab. "pending" is excluded either way - a
        # first-time seller's listing is not public until it is reviewed.
        query = query.filter(Listing.status == "available")
    else:
        query = query.filter(Listing.status != "pending")
    # Comma-separated, so "textbooks,notes" narrows to either of them. A
    # single value still works exactly as before, which is what the homepage
    # tiles and old shared links send.
    wanted = [c for c in (category or "").split(",") if c in ALLOWED_CATEGORIES]
    if wanted:
        query = query.filter(Listing.category.in_(wanted))

    order_clause = SORT_OPTIONS.get(sort, SORT_OPTIONS["newest"])
    query = query.order_by(order_clause)

    total = query.count()

    # A typed search that returns nothing is the single most useful signal the
    # site produces: it is somebody telling us what they came for and did not
    # find. Only the first page, and only real queries, so paging through an
    # empty result set doesn't count twice.
    if total == 0 and q.strip() and page == 1:
        track(db, "search_empty", viewer, q.strip())
        db.commit()

    listings = query.offset((page - 1) * limit).limit(limit).all()
    photo_map = get_photos_map(db, [l.id for l in listings])
    favorited_ids = get_favorited_ids(db, viewer, [l.id for l in listings])
    return {
        "results": [serialize_listing(l, photo_map.get(l.id), l.id in favorited_ids) for l in listings],
        "count": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 0,
        "sort": sort if sort in SORT_OPTIONS else "newest",
    }


@router.delete("/listings/{listing_id}")
def delete_listing(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    # sellers delete their own; admins can delete anything
    if listing.seller != username and not is_admin(username):
        raise HTTPException(status_code=403, detail="not_your_listing")

    photos = db.query(Photo).filter(Photo.listing_id == listing_id).all()
    for photo in photos:
        remove_photo_files(photo.file_path)
        db.delete(photo)

    db.delete(listing)
    db.commit()
    return {"message": "Listing deleted successfully"}


@router.get("/listings/{listing_id}/contact")
def get_contact(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    # throttled per account so listing IDs can't be walked to harvest every
    # seller's email + phone
    key = f"contact:{username}"
    check_rate_limit(key)
    record_attempt(key, CONTACT_MAX_ATTEMPTS, CONTACT_WINDOW_SECONDS, CONTACT_LOCKOUT_SECONDS)

    listing = get_listing_or_404(db, listing_id)
    seller = db.query(User).filter(User.id == listing.seller_id).first()
    if not seller:
        raise HTTPException(status_code=404, detail="seller_not_found")
    return {"email": seller.email, "phone": seller.phone}


@router.post("/listings/{listing_id}/photos")
def upload_photo(listing_id: int, username: str = Depends(require_user), file: UploadFile = File(...), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_allowed")

    existing_count = db.query(Photo).filter(Photo.listing_id == listing_id).count()
    if existing_count >= MAX_PHOTOS_PER_LISTING:
        raise HTTPException(
            status_code=400,
            detail={"code": "too_many_photos", "max": MAX_PHOTOS_PER_LISTING},
        )

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="unsupported_file_type",
        )

    contents = file.file.read()
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "file_too_large", "max_mb": MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)},
        )
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="file_empty")

    # Decode + recompress: validates the actual bytes (content_type is
    # client-supplied), strips EXIF/GPS, fixes rotation, and emits thumbnail
    # and WebP variants (see images.py).
    try:
        processed = process_image(contents)
    except ValueError:
        raise HTTPException(status_code=400, detail="file_not_image")

    os.makedirs("uploads/thumbs", exist_ok=True)
    file_path = f"uploads/{listing_id}_{uuid.uuid4().hex}.jpg"
    thumb_path = thumb_path_for(file_path)
    with open(file_path, "wb") as buffer:
        buffer.write(processed.full_jpeg)
    with open(thumb_path, "wb") as buffer:
        buffer.write(processed.thumb_jpeg)
    with open(webp_path_for(file_path), "wb") as buffer:
        buffer.write(processed.full_webp)
    with open(webp_path_for(thumb_path), "wb") as buffer:
        buffer.write(processed.thumb_webp)

    photo = Photo(listing_id=listing_id, file_path=file_path)
    db.add(photo)
    if not listing.photo_url:
        listing.photo_url = file_path
        db.add(listing)
    db.commit()

    return {"message": "Photo uploaded", "url": f"/{file_path}"}


@router.post("/listings")
def create_listing(body: ListingRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    # Idempotency guard: if this (account, token) pair already created a
    # listing, return that listing instead of a duplicate. Covers repeat
    # submissions the client-side disabled button doesn't catch. Fails open
    # if Redis is unreachable - an occasional duplicate beats nobody being
    # able to post.
    dedupe_key = f"listing_dedupe:{username}:{body.client_token}" if body.client_token else None
    if dedupe_key:
        existing_id = redis_or_none(redis_client.get, dedupe_key)
        if existing_id is not None:
            return {"message": "Listing created", "seller": username, "listing_id": int(existing_id)}

    key = f"create_listing:{username}"
    check_rate_limit(key)
    record_attempt(key, LISTING_MAX_ATTEMPTS, LISTING_WINDOW_SECONDS, LISTING_LOCKOUT_SECONDS)

    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="user_not_found")

    # A new account cannot put anything in front of students unseen: listings
    # go to review until the seller has TRUSTED_AFTER_APPROVED of them
    # approved, after which they post immediately.
    approved = (
        db.query(Listing)
        .filter(Listing.seller == username, Listing.status != "pending")
        .count()
    )
    status = "available" if (approved >= TRUSTED_AFTER_APPROVED or is_admin(username)) else "pending"

    listing = Listing(
        title=body.title,
        description=body.description,
        price=body.price,
        category=body.category,
        seller=username,
        seller_id=user.id,
        status=status,
        search_fold=fold(f"{body.title} {body.description}"),
    )
    db.add(listing)
    db.flush()
    # detail records whether it went live or to review, so the size of the
    # moderation queue is visible without counting rows by hand
    track(db, "listing_created", username, listing.status)
    db.commit()
    db.refresh(listing)

    if dedupe_key:
        redis_or_none(redis_client.set, dedupe_key, listing.id, ex=LISTING_DEDUPE_TTL_SECONDS)

    # Alerts only fire for listings people can actually open.
    if listing.status == "available":
        notify_saved_searches(db, listing)

    return {
        "message": "Listing created",
        "seller": username,
        "listing_id": listing.id,
        "pending_review": listing.status == "pending",
    }


@router.get("/my-listings")
def my_listings(
    status: str = "active",
    page: int = 1,
    limit: int = 20,
    username: str = Depends(require_user),
    db: Session = Depends(get_db),
):
    """The owner's listings for one tab (active/sold), paginated. Both tab
    totals are always returned so the tab badges stay correct regardless of
    which tab is loaded."""
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    base = db.query(Listing).filter(Listing.seller == username)
    active_count = base.filter(Listing.status != "sold").count()
    sold_count = base.filter(Listing.status == "sold").count()
    pending_count = base.filter(Listing.status == "pending").count()

    tab = base.filter(Listing.status == "sold") if status == "sold" else base.filter(Listing.status != "sold")
    total = sold_count if status == "sold" else active_count
    listings = tab.order_by(Listing.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    photo_map = get_photos_map(db, [l.id for l in listings])
    return {
        "listings": [serialize_listing(l, photo_map.get(l.id)) for l in listings],
        "active_count": active_count,
        "sold_count": sold_count,
        "pending_count": pending_count,
        "page": page,
        "pages": math.ceil(total / limit) if total else 0,
    }


@router.get("/users/{seller_username}/listings")
def seller_listings(
    seller_username: str,
    page: int = 1,
    limit: int = 20,
    username: str = Depends(optional_user),
    db: Session = Depends(get_db),
):
    """Public seller profile: their active listings, newest first. Sold items
    stay hidden and an unknown/banned seller 404s."""
    user = db.query(User).filter(User.username == seller_username).first()
    if not user or user.is_banned:
        raise HTTPException(status_code=404, detail="seller_not_found")
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    base = db.query(Listing).filter(Listing.seller == seller_username, Listing.status == "available")
    total = base.count()
    listings = base.order_by(Listing.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    photo_map = get_photos_map(db, [l.id for l in listings])
    favorited = get_favorited_ids(db, username, [l.id for l in listings])
    return {
        "seller": seller_username,
        "listings": [serialize_listing(l, photo_map.get(l.id), l.id in favorited) for l in listings],
        "count": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 0,
    }


@router.post("/listings/{listing_id}/bump")
def bump_listing(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    """Move an aged listing back to the top of "newest". Gated on age so it
    can't be spammed to squat the top of the feed."""
    listing = get_listing_or_404(db, listing_id)
    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_your_listing")
    age = datetime.utcnow() - (listing.created_at or datetime.utcnow())
    if age < timedelta(days=BUMP_MIN_AGE_DAYS):
        raise HTTPException(status_code=400, detail={"code": "renew_too_soon", "days": BUMP_MIN_AGE_DAYS})
    listing.created_at = datetime.utcnow()
    db.commit()
    return {"message": "Renewed"}


@router.post("/listings/{listing_id}/favorite")
def toggle_favorite(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    get_listing_or_404(db, listing_id)

    existing = db.query(Favorite).filter(
        Favorite.username == username, Favorite.listing_id == listing_id
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"favorited": False}

    db.add(Favorite(username=username, listing_id=listing_id))
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if listing and listing.seller != username:
        db.add(Notification(username=listing.seller, type="favorite", listing_id=listing_id, actor=username))
    db.commit()
    return {"favorited": True}


@router.get("/me/favorites")
def list_favorites(
    page: int = 1,
    limit: int = 20,
    username: str = Depends(require_user),
    db: Session = Depends(get_db),
):
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    favorite_ids = [
        r[0] for r in db.query(Favorite.listing_id).filter(Favorite.username == username).all()
    ]
    if not favorite_ids:
        return {"listings": [], "count": 0, "page": page, "pages": 0}

    base = db.query(Listing).filter(Listing.id.in_(favorite_ids)).order_by(Listing.id.desc())
    total = base.count()
    listings = base.offset((page - 1) * limit).limit(limit).all()
    photo_map = get_photos_map(db, [l.id for l in listings])
    return {
        "listings": [serialize_listing(l, photo_map.get(l.id), favorited=True) for l in listings],
        "count": total,
        "page": page,
        "pages": math.ceil(total / limit) if total else 0,
    }


@router.post("/listings/{listing_id}/view")
def record_view(listing_id: int, request: Request, viewer=Depends(optional_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    if viewer and viewer == listing.seller:
        return {"counted": False}

    # SET NX makes check-and-mark one atomic op. Fails open: an inflated
    # view count during a Redis outage is cosmetic.
    if not try_set_nx(f"viewdedupe:{client_ip(request)}:{listing_id}", 1, ex=VIEW_DEDUPE_SECONDS):
        return {"counted": False}

    listing.views = (listing.views or 0) + 1
    db.commit()
    return {"counted": True, "views": listing.views}


@router.put("/listings/{listing_id}")
def update_listing(listing_id: int, body: ListingRequest, username: str = Depends(require_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_your_listing")

    listing.title = body.title
    listing.description = body.description
    listing.price = body.price
    listing.category = body.category
    listing.search_fold = fold(f"{body.title} {body.description}")
    db.commit()
    return {"message": "Listing updated"}


@router.delete("/listings/{listing_id}/photos/{photo_id}")
def delete_photo(listing_id: int, photo_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_allowed")

    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.listing_id == listing_id)
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="photo_not_found")

    remove_photo_files(photo.file_path)

    deleted_path = photo.file_path
    db.delete(photo)
    db.flush()

    # if the cover photo was removed, promote the next remaining photo
    if listing.photo_url == deleted_path:
        remaining = (
            db.query(Photo)
            .filter(Photo.listing_id == listing_id)
            .order_by(Photo.id.asc())
            .first()
        )
        listing.photo_url = remaining.file_path if remaining else None

    db.commit()
    return {"message": "Photo removed"}


@router.patch("/listings/{listing_id}/sold")
def mark_as_sold(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    listing = get_listing_or_404(db, listing_id)

    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_your_listing")

    listing.status = "sold"
    listing.sold_at = datetime.utcnow()
    db.commit()
    return {"message": "Listing marked as sold"}


@router.patch("/listings/{listing_id}/unsold")
def mark_as_available(listing_id: int, username: str = Depends(require_user), db: Session = Depends(get_db)):
    """Undo for mark_as_sold; without it a mis-click could only be fixed by
    deleting and re-creating the listing."""
    listing = get_listing_or_404(db, listing_id)

    if listing.seller != username:
        raise HTTPException(status_code=403, detail="not_your_listing")

    # back to whatever it was before being sold: a listing that never
    # cleared review returns to the queue rather than going public
    listing.status = "available"
    listing.sold_at = None
    db.commit()
    return {"message": "Listing available again"}


@router.post("/listings/{listing_id}/report")
def report_listing(listing_id: int, body: ReportRequest, request: Request,
                   username: str = Depends(require_user), db: Session = Depends(get_db)):
    get_listing_or_404(db, listing_id)

    key = f"report:{client_ip(request)}"
    check_rate_limit(key)
    record_attempt(key, 10, 60 * 60, 60 * 60)

    # one open report per (user, listing)
    existing = db.query(Report).filter(
        Report.listing_id == listing_id,
        Report.reporter == username,
        Report.status == "open",
    ).first()
    if existing:
        return {"message": "Already reported"}

    db.add(Report(listing_id=listing_id, reporter=username, reason=body.reason.strip()))
    db.commit()
    return {"message": "Reported. Thanks for helping keep the marketplace safe."}
