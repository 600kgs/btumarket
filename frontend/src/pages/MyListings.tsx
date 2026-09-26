import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { type Listing } from "../lib/utils";
import ListingCard from "../components/ListingCard";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";

const tagIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8a2 2 0 0 1 2-2H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </svg>
);

export default function MyListings() {
  const { t } = useTranslation();
  usePageTitle("page_title_mylistings");
  const navigate = useNavigate();
  const { token } = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [tab, setTab] = useState<"active" | "sold">("active");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  // Both totals come from the backend so the tab badges stay correct no
  // matter which tab/page is currently loaded.
  const [activeCount, setActiveCount] = useState(0);
  const [soldCount, setSoldCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!token) {
      navigate("/login?reason=login_required&next=/mylistings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    const res = await authFetch(`${API}/my-listings?status=${tab}&page=${page}`);
    const data = await res.json();
    const items: Listing[] = data.listings || [];
    setActiveCount(data.active_count || 0);
    setSoldCount(data.sold_count || 0);
    setPendingCount(data.pending_count || 0);
    setTotalPages(data.pages || 0);
    // Deleting/marking-sold the last item on a page past the first strands us
    // on an empty page - step back and let that reload fill the view.
    if (items.length === 0 && page > 1) {
      setPage(page - 1);
      return;
    }
    setListings(items);
  }

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  function switchTab(next: "active" | "sold") {
    if (next === tab) return;
    setListings(null);
    setPage(1);
    setTab(next);
  }

  async function handleMarkSold(id: number) {
    if (!confirm(t("confirm_mark_sold"))) return;
    const res = await authFetch(`${API}/listings/${id}/sold`, { method: "PATCH" });
    if (res.ok) load();
  }

  // No confirm here: putting a listing back on sale is itself the undo, and
  // it's re-undoable in one click.
  async function handleMarkAvailable(id: number) {
    const res = await authFetch(`${API}/listings/${id}/unsold`, { method: "PATCH" });
    if (res.ok) load();
  }

  async function handleDelete(id: number) {
    if (!confirm(t("confirm_delete_listing"))) return;
    const res = await authFetch(`${API}/listings/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  // Mirrors the backend's BUMP_MIN_AGE_DAYS - the button only shows once
  // renewing would actually be accepted.
  const RENEW_MIN_AGE_MS = 180 * 24 * 60 * 60 * 1000;

  function canRenew(l: Listing): boolean {
    if (l.status === "sold" || !l.created_at) return false;
    // Backend sends naive UTC without a "Z" suffix (same parse rule as
    // relativeTime in utils.ts).
    const created = new Date(l.created_at + (l.created_at.endsWith("Z") ? "" : "Z")).getTime();
    return Date.now() - created >= RENEW_MIN_AGE_MS;
  }

  async function handleRenew(id: number) {
    const res = await authFetch(`${API}/listings/${id}/bump`, { method: "POST" });
    if (res.ok) {
      alert(t("renewed_ok"));
      load();
    } else {
      const data = await res.json().catch(() => null);
      alert(formatErrorDetail(data));
    }
  }

  const totalCount = activeCount + soldCount;

  return (
    <div className="container">
      <div className="page-head">
        <h2>{t("mylistings_title")}</h2>
        <div className="tab-row">
          <button type="button" className={`tab-btn${tab === "active" ? " active" : ""}`} onClick={() => switchTab("active")}>
            {t("tab_active")} <span className="tab-count">{activeCount}</span>
          </button>
          <button type="button" className={`tab-btn${tab === "sold" ? " active" : ""}`} onClick={() => switchTab("sold")}>
            {t("tab_sold")} <span className="tab-count">{soldCount}</span>
          </button>
        </div>
      </div>
      {pendingCount > 0 && <p className="pending-note">{t("pending_note")}</p>}
      {listings === null ? null : totalCount === 0 ? (
        <EmptyState
          icon={tagIcon}
          title={t("no_listings_yet")}
          action={<Link to="/post" className="empty-cta">{t("link_post_first")}</Link>}
        />
      ) : listings.length === 0 ? (
        <EmptyState icon={tagIcon} title={tab === "sold" ? t("no_sold_yet") : t("no_listings_yet")} />
      ) : (
        <>
          <div className="listings-grid">
            {listings.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                variant="compact"
                actions={
                  <div className="card-actions">
                    <button
                      className="card-action-btn full"
                      onClick={() => (l.status === "sold" ? handleMarkAvailable(l.id) : handleMarkSold(l.id))}
                    >
                      {l.status === "sold" ? t("btn_mark_available") : t("btn_mark_sold")}
                    </button>
                    <button className="card-action-btn" onClick={() => navigate(`/post?edit=${l.id}`)}>
                      {t("btn_edit")}
                    </button>
                    <button className="card-action-btn" onClick={() => handleDelete(l.id)}>
                      {t("btn_delete")}
                    </button>
                    {canRenew(l) && (
                      <button className="card-action-btn full" title={t("renew_title")} onClick={() => handleRenew(l.id)}>
                        {t("btn_renew")}
                      </button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
          <Pagination totalPages={totalPages} currentPage={page} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
