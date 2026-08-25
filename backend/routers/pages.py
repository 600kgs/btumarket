"""Health check, server-rendered listing pages (Open Graph tags), and the
crawler-facing plumbing (robots.txt, sitemap.xml)."""
import html
import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import FRONTEND_DIR, SITE_URL
from database import Listing, Photo, get_db
from images import thumb_path_for

logger = logging.getLogger("btumarket")

router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """A real DB round-trip, not just process-is-up. Used by the external
    uptime monitor. Docker's own healthcheck uses /health/live instead -
    it polls every 30s, which is far more often than Neon's 5-minute
    autosuspend window, so hitting the DB here would keep the compute
    permanently awake and burn through the monthly compute-hour quota
    with no real traffic at all."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check DB query failed")
        raise HTTPException(status_code=503, detail="database unreachable")
    return {"status": "ok"}


@router.get("/health/live")
def health_live():
    """Process-is-up check, no DB round-trip. Used by Docker's healthcheck."""
    return {"status": "ok"}


def _truncate_for_meta(text_: str, max_len: int = 160) -> str:
    text_ = (text_ or "").strip()
    return text_ if len(text_) <= max_len else text_[: max_len - 1].rstrip() + "…"


def _read_frontend_entry() -> str:
    for name in ("listing.html", "index.html"):
        path = os.path.join(FRONTEND_DIR, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return f.read()
    raise FileNotFoundError(f"No listing.html or index.html found in {FRONTEND_DIR}")


def _render_listing_page(listing_id: int | None, db: Session) -> tuple[str, int]:
    """SPA entry HTML with Open Graph tags injected for one listing. Done
    server-side because link-preview bots fetch raw HTML and never run JS.

    Returns (html, status). A missing listing serves the same SPA shell (the
    frontend renders its own not-found state) with a 404 status so crawlers
    drop the dead URL.
    """
    page = _read_frontend_entry()
    if listing_id is None:
        return page, 404

    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        return page, 404

    photo = (
        db.query(Photo)
        .filter(Photo.listing_id == listing_id)
        .order_by(Photo.id.asc())
        .first()
    )
    if photo:
        thumb = thumb_path_for(photo.file_path)
        image_path = thumb if os.path.exists(thumb) else photo.file_path
    else:
        image_path = "favicon-192.png"  # branded fallback

    title = html.escape(f"{listing.title} - {listing.price:g}₾")
    description = html.escape(_truncate_for_meta(listing.description))
    image_url = f"{SITE_URL}/{image_path}"
    page_url = f"{SITE_URL}/listing/{listing_id}"

    # strip the homepage's baked-in og/twitter tags first; crawlers take the
    # first tag they see
    page = re.sub(r'\s*<meta (?:property="og:|name="twitter:)[^>]*>', "", page)

    og_tags = (
        f'    <meta property="og:title" content="{title}">\n'
        f'    <meta property="og:description" content="{description}">\n'
        f'    <meta property="og:image" content="{image_url}">\n'
        f'    <meta property="og:type" content="product">\n'
        f'    <meta property="og:url" content="{page_url}">\n'
        f'    <meta name="twitter:card" content="summary_large_image">\n'
    )
    return page.replace("</head>", og_tags + "</head>"), 200


def _parse_listing_id(raw: str | None) -> int | None:
    try:
        return int(raw) if raw else None
    except (TypeError, ValueError):
        return None


@router.get("/listing/{listing_id}", response_class=HTMLResponse)
def listing_page(listing_id: str, db: Session = Depends(get_db)):
    """Canonical listing URL, e.g. /listing/123."""
    page, status = _render_listing_page(_parse_listing_id(listing_id), db)
    return HTMLResponse(page, status_code=status)


@router.get("/listing.html", response_class=HTMLResponse)
def listing_page_legacy(id: str | None = None, db: Session = Depends(get_db)):
    """Old query-string URL, kept for links shared before the clean-path
    switch. Serves OG so old previews keep working; the frontend redirects
    human visitors to the canonical path."""
    page, status = _render_listing_page(_parse_listing_id(id), db)
    return HTMLResponse(page, status_code=status)


@router.get("/robots.txt", response_class=PlainTextResponse)
def robots_txt():
    return (
        "User-agent: *\n"
        "Disallow: /admin\n"
        "Disallow: /messages\n"
        "Disallow: /settings\n"
        "Disallow: /mylistings\n"
        "Disallow: /favorites\n"
        "Disallow: /post\n"
        f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )


@router.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)):
    """Static pages plus every active listing."""
    static_paths = ["", "/products", "/how-it-works", "/safety", "/contact", "/terms", "/privacy"]
    urls = [f"  <url><loc>{SITE_URL}{p}</loc></url>" for p in static_paths]
    rows = (
        db.query(Listing.id, Listing.created_at)
        .filter(Listing.status != "sold")
        .order_by(Listing.id.desc())
        .limit(5000)
        .all()
    )
    for lid, created in rows:
        lastmod = f"<lastmod>{created.date().isoformat()}</lastmod>" if created else ""
        urls.append(f"  <url><loc>{SITE_URL}/listing/{lid}</loc>{lastmod}</url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")
