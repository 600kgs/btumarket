import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch } from "../lib/api";
import { catLabel, firstName, listingPhotos, relativeTime, thumbUrl, viewsLabel, webpUrl, type Listing } from "../lib/utils";
import { EyeIcon, FavoriteHeartIcon, NoImageIcon } from "./icons";

interface ListingCardProps {
  listing: Listing;
  /** My Listings needs mark-sold/edit/delete buttons under the card - passed
   * in rather than hardcoded here, so this component stays reusable across
   * Index/Favorites (no actions) and MyListings (three actions). */
  actions?: ReactNode;
  /** Favorites page removes the card from its list entirely on unfavorite,
   * rather than just flipping the heart icon. */
  onFavoriteToggle?: (id: number, favorited: boolean) => void;
  /** MyListings' original markup omitted the description and the eye icon
   * (plain "N views" text instead) - kept togglable rather than forking
   * the whole component. */
  variant?: "default" | "compact";
  /** "top" renders a small badge on the photo - used by the homepage's
   * popular carousel for its most-viewed items. The FREE badge is derived
   * from price === 0 automatically, not passed in. */
  badge?: "top";
}

export default function ListingCard({ listing, actions, onFavoriteToggle, variant = "default", badge }: ListingCardProps) {
  const { t } = useTranslation();
  const photos = listingPhotos(listing);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [favorited, setFavorited] = useState(listing.is_favorited);
  const [imgSrc, setImgSrc] = useState(photos.length ? `${API}/${thumbUrl(photos[0])}` : "");
  const [usedFullSize, setUsedFullSize] = useState(false);
  // Transient - drives a one-off pop animation only when the user favorites
  // (not on load for already-favorited cards, and not on un-favoriting).
  const [pop, setPop] = useState(false);

  function goToPhoto(index: number) {
    setPhotoIndex(index);
    setUsedFullSize(false);
    setImgSrc(`${API}/${thumbUrl(photos[index])}`);
  }

  function handleImgError() {
    // Thumbnail missing (photo predates thumbnail generation) - fall back
    // to the full-size image once, not in a loop.
    if (!usedFullSize) {
      setUsedFullSize(true);
      setImgSrc(`${API}/${photos[photoIndex]}`);
    }
  }

  async function handleFavoriteClick(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await authFetch(`${API}/listings/${listing.id}/favorite`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setFavorited(data.favorited);
    if (data.favorited) {
      setPop(true);
      setTimeout(() => setPop(false), 340);
    }
    onFavoriteToggle?.(listing.id, data.favorited);
  }

  const favoriteLabel = t(favorited ? "fav_remove" : "fav_add");

  const photoArea = (
    <div className="card-photo-wrap">
      {/* All top-left badges live in one stacking column so any combination
          (sold / category / featured / free) lays out cleanly - previously
          each was absolutely positioned with a hardcoded top offset, and a
          card that was both featured AND free dropped the second chip back
          onto the category pill. */}
      {/* Badges and the heart share one flex row across the top of the photo,
          so the browser works out the collision itself: the heart keeps its
          natural width and the badge column takes whatever is left, ellipsising
          a long category only when it actually runs out of room. (Positioning
          them separately meant hardcoding a pixel reserve for the heart, which
          didn't scale down to phone-sized cards.) */}
      <div className="card-photo-overlay">
        <div className="card-badges">
          {listing.status === "sold" && <span className="sold-badge">SOLD</span>}
          {listing.status === "pending" && <span className="flag-chip chip-pending">{t("chip_pending")}</span>}
          {listing.category && (
            <span className="category-pill card-category" data-category={listing.category}>
              {catLabel(listing.category, t)}
            </span>
          )}
          {badge === "top" && <span className="flag-chip chip-top">{t("chip_top")}</span>}
          {listing.price === 0 && <span className="flag-chip chip-free">{t("price_free")}</span>}
        </div>
        <button
          type="button"
          className={`favorite-btn${favorited ? " active" : ""}${pop ? " pop" : ""}`}
          onClick={handleFavoriteClick}
          aria-label={favoriteLabel}
          title={favoriteLabel}
        >
          <FavoriteHeartIcon />
        </button>
      </div>
      {photos.length === 0 ? (
        <NoImageWithLabel category={listing.category} label={t("no_image")} />
      ) : (
        <>
          <picture>
            {/* Derived from imgSrc (not reconstructed from photos[photoIndex])
                so this always matches whichever JPEG variant is currently
                showing - the thumbnail, or the full-size fallback after
                handleImgError. */}
            <source type="image/webp" srcSet={webpUrl(imgSrc)} />
            <img className="card-photo" src={imgSrc} onError={handleImgError} alt={listing.title} loading="lazy" />
          </picture>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="card-photo-nav card-photo-prev"
                aria-label="Previous photo"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPhoto((photoIndex - 1 + photos.length) % photos.length);
                }}
              >
                &#8249;
              </button>
              <button
                type="button"
                className="card-photo-nav card-photo-next"
                aria-label="Next photo"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPhoto((photoIndex + 1) % photos.length);
                }}
              >
                &#8250;
              </button>
              <div className="card-photo-dots">
                {photos.map((_, i) => (
                  <span key={i} className={`dot${i === photoIndex ? " active" : ""}`} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  const cardBody = (
    <div className="card-body">
      <h3>
        {/* The card's one link. Its ::after stretches over the whole card
            (see .card-link in style.css), so the card is clickable, keyboard
            focusable and openable in a new tab, without nesting the buttons
            inside an anchor. */}
        <Link to={`/listing/${listing.id}`} className="card-link">
          {listing.title} <span className="listing-id">#{listing.id}</span>
        </Link>
      </h3>
      <div className="price">{listing.price === 0 ? t("price_free") : `${listing.price} ₾`}</div>
      <div className="card-footer">
        <div className="card-meta">
          {variant === "default" ? (
            // Public cards hide a 0 so a brand-new listing doesn't broadcast
            // "nobody's looked at this" - the eye only appears once it has
            // real views, and joins the seller/time line rather than sitting
            // apart (see the mobile .card-meta rules).
            listing.views > 0 && (
              <span className="meta-views-group">
                <span className="views-inline" title={viewsLabel(listing.views, t)}>
                  <EyeIcon />
                  <span className="views-count">{listing.views}</span>
                </span>
                <span className="meta-dot">·</span>
              </span>
            )
          ) : (
            // My Listings (compact): the owner sees their own count, 0 included.
            <span className="meta-views-group">
              <span>{viewsLabel(listing.views, t)}</span>
              <span className="meta-dot">·</span>
            </span>
          )}
          <span className="meta-identity-group">
            {variant === "default" && (
              <>
                <Link
                  className="card-seller card-seller-link"
                  title={listing.seller}
                  to={`/seller/${encodeURIComponent(listing.seller)}`}
                >
                  {firstName(listing.seller)}
                </Link>
                <span className="meta-dot">·</span>
              </>
            )}
            <span className="meta-time">{relativeTime(listing.created_at, t)}</span>
          </span>
        </div>
      </div>
    </div>
  );

  if (actions) {
    // MyListings shape: the link only stretches over card-main, so the
    // action buttons underneath stay their own controls.
    return (
      <div className="listing-card">
        <div className="card-main">
          {photoArea}
          {cardBody}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className="listing-card">
      {photoArea}
      {cardBody}
    </div>
  );
}

function NoImageWithLabel({ category, label }: { category?: string | null; label: string }) {
  return (
    <div className="no-image" data-category={category || "other"}>
      <NoImageIcon category={category} />
      <span>{label}</span>
    </div>
  );
}
