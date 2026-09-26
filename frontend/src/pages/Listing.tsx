import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, AuthRedirect, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { catLabel, listingPhotos, relativeTime, viewsLabel, webpUrl, type Listing as ListingType } from "../lib/utils";
import { FavoriteHeartIcon, NoImageIcon } from "../components/icons";
import ListingCard from "../components/ListingCard";

// The detail thumbnail strip is a fixed 6-up row: up to 6 tiles, and once
// there are more than 6 photos the 6th becomes a "+N" tile into the gallery.
const THUMB_LIMIT = 6;

export default function Listing() {
  const { t } = useTranslation();
  usePageTitle("page_title_listing");
  const navigate = useNavigate();
  const { id: listingId } = useParams();
  const { username, token } = useAuth();

  const [listing, setListing] = useState<ListingType | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [contact, setContact] = useState<{ email: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<ListingType[]>([]);
  const [copied, setCopied] = useState(false);
  const similarRef = useRef<HTMLDivElement>(null);

  function scrollSimilar(direction: 1 | -1) {
    similarRef.current?.scrollBy({ left: direction * 500, behavior: "smooth" });
  }

  useEffect(() => {
    if (!listingId) {
      navigate("/");
    }
  }, [listingId, navigate]);

  async function loadListing() {
    if (!listingId) return;
    try {
      const res = await authFetch(`${API}/listings/${listingId}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const l = await res.json();
      setListing(l);
      setFavorited(l.is_favorited);
      setGalleryIndex(0);
      pingView(l.seller);
    } catch (e) {
      if (e instanceof AuthRedirect) return;
      throw e;
    }
  }

  useEffect(() => {
    loadListing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  // Similar listings: same category, newest, minus this one. Optional -
  // renders nothing if the fetch fails or comes back empty.
  useEffect(() => {
    if (!listing?.category) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/search?q=&page=1&sort=newest&category=${encodeURIComponent(listing.category)}`);
        const data = await res.json();
        if (cancelled) return;
        setSimilar((data.results as ListingType[]).filter((l) => l.id !== listing.id).slice(0, 8));
      } catch {
        /* optional section */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, listing?.category]);

  async function handleShare() {
    const url = `https://btumarket.ge/listing/${listingId}`;
    // The native share sheet (phones) opens into whatever app the user
    // actually uses - link previews come from the OG tags the backend
    // injects. Desktop falls back to copying the link.
    if (navigator.share) {
      try {
        await navigator.share({ title: listing?.title, url });
        return;
      } catch {
        /* user closed the sheet - fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (http, old browser) - nothing to do */
    }
  }

  // Counts a view for non-owners, at most once per browser per 6 hours. The
  // backend applies its own owner + IP checks on top of this.
  function pingView(seller: string) {
    if (username && username === seller) return;
    const key = `viewed:${listingId}`;
    const last = parseInt(localStorage.getItem(key) || "0", 10);
    if (Date.now() - last < 6 * 60 * 60 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
    fetch(`${API}/listings/${listingId}/view`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!lightboxOpen) return;
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowLeft") changePhoto(-1);
      if (e.key === "ArrowRight") changePhoto(1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, listing]);

  useEffect(() => {
    document.body.style.overflow = lightboxOpen ? "hidden" : "";
  }, [lightboxOpen]);

  if (notFound) {
    return (
      <div className="listing-detail">
        <Link to="/" className="back-link">
          {t("back_to_listings")}
        </Link>
        <p style={{ padding: 40, textAlign: "center", color: "#aaa" }}>{t("listing_not_found")}</p>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="listing-detail">
        <Link to="/" className="back-link">
          {t("back_to_listings")}
        </Link>
        <div className="listing-detail-card">
          <div className="gallery-wrap">
            <p style={{ padding: 40, textAlign: "center", color: "#aaa" }}>{t("loading")}</p>
          </div>
        </div>
      </div>
    );
  }

  const photos = listingPhotos(listing);
  const isOwner = username === listing.seller;
  const sold = listing.status === "sold";

  function changePhoto(direction: number) {
    if (photos.length === 0) return;
    setGalleryIndex((i) => (i + direction + photos.length) % photos.length);
  }

  async function handleGetContact() {
    const res = await authFetch(`${API}/listings/${listingId}/contact`);
    const data = await res.json();
    if (res.ok) {
      setContact(data);
    } else {
      setError(formatErrorDetail(data));
    }
  }

  async function handleToggleFavorite() {
    const res = await authFetch(`${API}/listings/${listingId}/favorite`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setFavorited(data.favorited);
  }

  async function handleReport() {
    const reason = prompt(t("report_prompt"));
    if (!reason || !reason.trim()) return;
    const res = await authFetch(`${API}/listings/${listingId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim().slice(0, 500) }),
    });
    if (res.ok) {
      alert(t("report_sent"));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(formatErrorDetail(data));
    }
  }

  async function handleMarkSold() {
    if (!confirm(t("confirm_mark_sold2"))) return;
    const res = await authFetch(`${API}/listings/${listingId}/sold`, { method: "PATCH" });
    if (res.ok) loadListing();
  }

  async function handleDelete() {
    if (!confirm(t("confirm_delete_listing2"))) return;
    const res = await authFetch(`${API}/listings/${listingId}`, { method: "DELETE" });
    if (res.ok) {
      navigate("/");
    } else {
      const data = await res.json();
      setError(formatErrorDetail(data));
    }
  }

  function goToChat() {
    navigate(`/messages?listing_id=${listing!.id}&to=${encodeURIComponent(listing!.seller)}`);
  }

  return (
    <div className="listing-detail">
      <Link to="/" className="back-link">
        {t("back_to_listings")}
      </Link>

      <div className="listing-detail-card detail-two-col">
        <div className="detail-media">
        <div className="gallery-wrap">
          {sold && <div className="sold-badge">SOLD</div>}
          {photos.length === 0 ? (
            <div className="no-image" data-category={listing.category}>
              <NoImageIcon category={listing.category} />
              <span>{t("no_image")}</span>
            </div>
          ) : (
            <>
              <picture>
                <source type="image/webp" srcSet={`${API}/${webpUrl(photos[galleryIndex])}`} />
                <img
                  src={`${API}/${photos[galleryIndex]}`}
                  alt="Listing photo"
                  onClick={() => setLightboxOpen(true)}
                />
              </picture>
              {photos.length > 1 && (
                <>
                  <button type="button" className="gallery-nav gallery-prev" aria-label="Previous photo" onClick={() => changePhoto(-1)}>
                    &#8249;
                  </button>
                  <button type="button" className="gallery-nav gallery-next" aria-label="Next photo" onClick={() => changePhoto(1)}>
                    &#8250;
                  </button>
                  <div className="gallery-dots">
                    {photos.map((_, i) => (
                      <span key={i} className={`dot${i === galleryIndex ? " active" : ""}`} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {photos.length > 1 && (
          <div className="photo-thumbs">
            {/* Keep the strip to a single row: show up to 5 thumbnails, but once
                there are more than 5, the 5th becomes a "+N" tile that opens the
                fullscreen gallery to browse the rest (rather than wrapping to a
                second row). */}
            {(photos.length > THUMB_LIMIT ? photos.slice(0, THUMB_LIMIT - 1) : photos).map((photo, i) => (
              <button
                key={i}
                type="button"
                className={`photo-thumb${i === galleryIndex ? " active" : ""}`}
                onClick={() => setGalleryIndex(i)}
              >
                <picture>
                  <source type="image/webp" srcSet={`${API}/${webpUrl(photo)}`} />
                  <img src={`${API}/${photo}`} alt={`Photo ${i + 1}`} />
                </picture>
              </button>
            ))}
            {photos.length > THUMB_LIMIT && (
              <button
                type="button"
                className="photo-thumb photo-thumb-more"
                aria-label={t("photos_see_all")}
                onClick={() => {
                  setGalleryIndex(THUMB_LIMIT - 1);
                  setLightboxOpen(true);
                }}
              >
                <picture>
                  <source type="image/webp" srcSet={`${API}/${webpUrl(photos[THUMB_LIMIT - 1])}`} />
                  <img src={`${API}/${photos[THUMB_LIMIT - 1]}`} alt="" />
                </picture>
                <span className="photo-thumb-more-overlay">+{photos.length - (THUMB_LIMIT - 1)}</span>
              </button>
            )}
          </div>
        )}

        <div className="detail-desc-block">
          <h2>{t("desc_title")}</h2>
          <div className="listing-description" style={{ whiteSpace: "pre-wrap" }}>
            {listing.description}
          </div>
        </div>
        </div>

        <aside className="detail-side">
          <h1>
            {listing.title} <span className="listing-id">#{listing.id}</span>
          </h1>
          <div className="detail-price">{listing.price === 0 ? t("price_free") : `${listing.price} ₾`}</div>
          <div className="detail-meta-row">
            <span className="category-pill" data-category={listing.category}>
              {catLabel(listing.category, t)}
            </span>
            <span>{viewsLabel(listing.views, t)}</span>
            <span className="meta-dot">·</span>
            <span>{relativeTime(listing.created_at, t)}</span>
          </div>

          <Link className="seller-row" to={`/seller/${encodeURIComponent(listing.seller)}`}>
            <span className="seller-row-avatar">{listing.seller.trim().charAt(0).toUpperCase()}</span>
            <span className="seller-row-info">
              <span className="seller-row-name">{listing.seller}</span>
              <span className="seller-row-link">
                {t("seller_view_profile")}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
            </span>
          </Link>

          <div className="listing-actions">
            {token && !isOwner && (
              <button className="btn-contact" onClick={goToChat}>
                {t("btn_message_seller")}
              </button>
            )}
            {!isOwner && (
              <button className={`favorite-btn-inline${favorited ? " active" : ""}`} onClick={handleToggleFavorite}>
                <FavoriteHeartIcon /> <span>{t(favorited ? "fav_remove" : "fav_add")}</span>
              </button>
            )}
            {token && !isOwner && (
              <button className="btn-secondary" onClick={handleGetContact}>
                {t("btn_show_contact")}
              </button>
            )}
            {!token && (
              <button className="btn-contact" onClick={() => navigate("/login")}>
                {t("btn_login_contact")}
              </button>
            )}
            {isOwner && (
              <>
                <button className="btn-contact" onClick={handleMarkSold} disabled={sold} style={sold ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
                  {sold ? t("btn_already_sold") : t("btn_mark_as_sold")}
                </button>
                <button className="btn-secondary" onClick={() => navigate(`/post?edit=${listing.id}`)}>
                  {t("btn_edit_listing")}
                </button>
                <button className="btn-delete" onClick={handleDelete}>
                  {t("btn_delete_listing")}
                </button>
              </>
            )}
          </div>

          {contact && (
            <div className="contact-box" style={{ display: "block" }}>
              <p>
                <strong>{t("contact_email_label")}</strong> <span>{contact.email}</span>
              </p>
              {contact.phone && (
                <p>
                  <strong>{t("contact_phone_label")}</strong> <span>{contact.phone}</span>
                </p>
              )}
            </div>
          )}

          <div className="share-row">
            <button type="button" className="btn-share" onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <path d="m8.6 10.5 6.8-3.9M8.6 13.5l6.8 3.9" />
              </svg>
              {copied ? t("link_copied") : t("btn_share")}
            </button>
            {token && !isOwner && (
              <button type="button" className="report-link" onClick={handleReport}>
                ⚑ {t("btn_report")}
              </button>
            )}
          </div>

          <div className="seller-info safety-note">
            🤝 <strong>{t("safety_title")}</strong> {t("safety_text")}
          </div>
        </aside>
      </div>

      {similar.length > 0 && (
        <section className="similar-section">
          <div className="section-head">
            <h2>{t("similar_title")}</h2>
            <span className="section-spacer" />
            <Link to={`/products?category=${listing.category}`} className="see-all">
              {t("see_all")}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
            {/* Prev/next arrows match the homepage carousels; CSS hides them on
                phones, where the row is swipe-scrollable. */}
            <div className="carousel-pager">
              <button type="button" aria-label={t("btn_prev")} onClick={() => scrollSimilar(-1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 6-6 6 6 6" />
                </svg>
              </button>
              <button type="button" aria-label={t("btn_next")} onClick={() => scrollSimilar(1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
          <div className="carousel similar-carousel" ref={similarRef}>
            {similar.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-msg">{error}</div>}

      {lightboxOpen && (
        <div className="lightbox open" onClick={() => setLightboxOpen(false)}>
          <button type="button" className="lightbox-close" aria-label="Close" onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}>
            &times;
          </button>
          <button type="button" className="lightbox-nav lightbox-prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); changePhoto(-1); }}>
            &#8249;
          </button>
          <picture>
            <source type="image/webp" srcSet={`${API}/${webpUrl(photos[galleryIndex])}`} />
            <img src={`${API}/${photos[galleryIndex]}`} alt="Listing photo, enlarged" onClick={(e) => e.stopPropagation()} />
          </picture>
          <button type="button" className="lightbox-nav lightbox-next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); changePhoto(1); }}>
            &#8250;
          </button>
          <div className="lightbox-counter">
            {galleryIndex + 1} / {photos.length}
          </div>
        </div>
      )}
    </div>
  );
}
