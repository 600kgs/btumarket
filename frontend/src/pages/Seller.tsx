import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import type { Listing } from "../lib/utils";
import ListingCard from "../components/ListingCard";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";

export default function Seller() {
  const { t } = useTranslation();
  usePageTitle("page_title_seller");
  const { username } = useParams();
  const sellerName = username || "";
  const { token } = useAuth();

  const [listings, setListings] = useState<Listing[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);

  // A different seller starts over at page 1.
  useEffect(() => {
    setPage(1);
  }, [sellerName]);

  useEffect(() => {
    if (!sellerName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/users/${encodeURIComponent(sellerName)}/listings?page=${page}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          setLoaded(true);
          return;
        }
        const data = await res.json();
        setListings(data.listings);
        setTotalPages(data.pages || 0);
        setTotal(data.count || 0);
        setLoaded(true);
        window.scrollTo(0, 0);
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerName, token, page]);

  if (!sellerName || notFound) {
    return (
      <div className="container">
        <div className="static-page">
          <h1>{t("seller_not_found")}</h1>
          <Link className="static-cta" to="/">{t("back_to_listings")}</Link>
        </div>
      </div>
    );
  }

  const initial = sellerName.trim().charAt(0).toUpperCase();

  return (
    <div className="container">
      <div className="seller-header">
        <span className="seller-avatar">{initial}</span>
        <div>
          <h1>{sellerName}</h1>
          <p className="seller-sub">
            <span className="trust-mark">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {t("trust_chip")}
            </span>
            {loaded && (total === 1 ? t("seller_count_one") : t("seller_count_other", { count: total }))}
          </p>
        </div>
      </div>

      {loaded && total === 0 ? (
        <EmptyState
          icon={
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 9h18l-1 11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1L3 9z" />
              <path d="M8 9V6a4 4 0 0 1 8 0v3" />
            </svg>
          }
          title={t("seller_no_listings")}
        />
      ) : (
        <>
          <div className="listings-grid seller-grid">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          <Pagination totalPages={totalPages} currentPage={page} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
