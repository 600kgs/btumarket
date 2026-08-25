import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { type Listing } from "../lib/utils";
import ListingCard from "../components/ListingCard";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";

export default function Favorites() {
  const { t } = useTranslation();
  usePageTitle("page_title_favorites");
  const navigate = useNavigate();
  const { token } = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    if (!token) {
      navigate("/login?reason=login_required&next=/favorites");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    const res = await authFetch(`${API}/me/favorites?page=${page}`);
    const data = await res.json();
    setListings(data.listings || []);
    setTotalPages(data.pages || 0);
  }

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Unfavoriting removes the card from this page entirely. If it was the
  // last item on a page past the first, step back a page.
  function handleFavoriteToggle(_id: number, favorited: boolean) {
    if (favorited) return;
    if (listings && listings.length === 1 && page > 1) setPage(page - 1);
    else load();
  }

  return (
    <div className="container">
      <h2 style={{ marginBottom: 20 }}>{t("favorites_title")}</h2>
      {listings === null ? null : listings.length === 0 ? (
        <EmptyState
          icon={
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
            </svg>
          }
          title={t("no_favorites_yet")}
          action={<Link to="/products" className="empty-cta">{t("link_browse_favorites")}</Link>}
        />
      ) : (
        <>
          <div className="listings-grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} onFavoriteToggle={handleFavoriteToggle} />
            ))}
          </div>
          <Pagination totalPages={totalPages} currentPage={page} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
