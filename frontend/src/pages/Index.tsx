import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch } from "../lib/api";
import { CATEGORIES, catLabel, listingPhotos, thumbUrl, webpUrl, type Listing } from "../lib/utils";
import { usePageTitle } from "../lib/usePageTitle";
import CategoryIcon from "../components/CategoryIcon";
import ListingCard from "../components/ListingCard";
import CardSkeleton from "../components/CardSkeleton";
import EmptyState from "../components/EmptyState";

// Below this many photographed listings, a Featured rail would just be the
// newest items shown twice.
const MIN_FEATURED = 6;

// The landing page: category tiles, a most-viewed carousel, and a capped row
// of the newest listings - all teasers. Every browse action (the tiles, the
// header search, the "View all" links) leads to /products, which owns the
// full filterable/paginated grid.
export default function Index() {
  const { t } = useTranslation();
  usePageTitle("page_title_index");

  const [popular, setPopular] = useState<Listing[]>([]);
  const [recent, setRecent] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pop, rec] = await Promise.all([
          authFetch(`${API}/search?q=&page=1&sort=most_viewed&limit=24`).then((r) => r.json()),
          authFetch(`${API}/search?q=&page=1&sort=newest`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setPopular((pop.results as Listing[]).slice(0, 24));
        setRecent((rec.results as Listing[]).slice(0, 10));
      } catch {
        /* sections are optional - a failed fetch just leaves them empty */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function scrollCarousel(direction: 1 | -1) {
    carouselRef.current?.scrollBy({ left: direction * 500, behavior: "smooth" });
  }

  // Featured is a storefront window - only show items that actually have a
  // photo, so neither the hero collage nor the Featured row ever falls back
  // to the grey "no image" state.
  const withPhotos = popular.filter((l) => listingPhotos(l).length > 0).slice(0, 12);
  const heroItems = withPhotos.slice(0, 3);
  // A "featured" rail that repeats what is already in "just posted" below
  // reads as padding, so it waits until there is enough stock to be a real
  // selection rather than the same few items twice.
  const showFeatured = withPhotos.length >= MIN_FEATURED;
  const recentShown = showFeatured
    ? recent
    : recent.filter((l) => !withPhotos.some((f) => f.id === l.id)).concat(withPhotos);
  const isEmpty = loaded && recent.length === 0 && popular.length === 0;

  return (
    <div className="container">
      <section className="home-hero">
        <div className="hero-text">
          <span className="hero-eyebrow">
            <CheckMark />
            {t("hero_trust")}
          </span>
          <h1 className="hero-headline">
            {t("hero_action_1")} {t("hero_action_2")}{" "}
            <span className="hero-accent">{t("hero_action_3")}</span>
          </h1>
          <p className="hero-lead">{t("hero_lead")}</p>
          <div className="hero-chips">
            <span><CheckMark />{t("hero_chip_fees")}</span>
            <span><CheckMark />{t("hero_chip_cash")}</span>
            <span><CheckMark />{t("hero_chip_fast")}</span>
          </div>
        </div>
        {heroItems.length >= 2 && (
          <div className="hero-collage" aria-hidden="true">
            {heroItems.map((l, i) => (
              <Link key={l.id} to={`/listing/${l.id}`} className={`hero-tile${i === 0 ? " big" : ""}`} data-category={l.category}>
                <picture>
                  <source type="image/webp" srcSet={webpUrl(`${API}/${thumbUrl(listingPhotos(l)[0])}`)} />
                  <img src={`${API}/${thumbUrl(listingPhotos(l)[0])}`} alt="" loading="lazy" />
                </picture>
                <span className="hero-price">{l.price === 0 ? t("price_free") : `${l.price} ₾`}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* The tiles sit on their own white "shelf" so they read as one distinct
          block rather than bleeding out of the hero above. */}
      <section className="category-shelf" aria-label={t("browse_categories")}>
        <div className="category-tiles">
          <Link to="/products" className="tile tile-all">
            <span>{t("tile_all")}</span>
            <CategoryIcon name="all" className="tile-icon" />
          </Link>
          {CATEGORIES.map((cat) => (
            <Link key={cat} to={`/products?category=${cat}`} className="tile" data-category={cat}>
              <span>{catLabel(cat, t)}</span>
              <CategoryIcon name={cat} className="tile-icon" />
            </Link>
          ))}
          <Link to="/products?free=1" className="tile tile-free">
            <span>{t("cat_free")}</span>
            <CategoryIcon name="free" className="tile-icon" />
          </Link>
        </div>
      </section>

      {showFeatured && (
        <section>
          <div className="section-head">
            <span className="section-flag popular"><CategoryIcon name="popular" /></span>
            <h2>{t("sec_popular")}</h2>
            <span className="section-spacer" />
            <Link to="/products?sort=most_viewed" className="see-all">
              {t("see_all")}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
            <div className="carousel-pager">
              <button type="button" aria-label={t("btn_prev")} onClick={() => scrollCarousel(-1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 6-6 6 6 6" />
                </svg>
              </button>
              <button type="button" aria-label={t("btn_next")} onClick={() => scrollCarousel(1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
          <div className="carousel" ref={carouselRef}>
            {withPhotos.map((listing, i) => (
              <ListingCard key={listing.id} listing={listing} badge={i < 3 ? "top" : undefined} />
            ))}
          </div>
        </section>
      )}

      {!isEmpty && (
      <div className="cta-banner">
        <div className="banner-copy">
          <h2>{t("banner_title")}</h2>
          <p>{t("banner_sub")}</p>
        </div>
        <Link to="/post" className="banner-btn">{t("nav_post")}</Link>
      </div>
      )}

      {!isEmpty && (
      <div className="section-head">
        <span className="section-flag recent"><CategoryIcon name="recent" /></span>
        <h2>{t("sec_new")}</h2>
        <span className="section-spacer" />
        <Link to="/products" className="see-all">
          {t("see_all")}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<CategoryIcon name="all" />}
          title={t("home_empty_title")}
          action={<Link to="/post" className="empty-cta">{t("link_post_first")}</Link>}
        />
      ) : (
        <div className="listings-grid">
          {loaded
            ? recentShown.map((listing) => <ListingCard key={listing.id} listing={listing} />)
            : Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
