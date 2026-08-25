import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

// Shared page navigator: prev/next chevrons plus first, last, and current ± 1
// page numbers with ellipses between gaps. Renders nothing for a single page.
// Used by the homepage results and the Favorites / My Listings / Seller grids.
export default function Pagination({
  totalPages,
  currentPage,
  onPageChange,
}: {
  totalPages: number;
  currentPage: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  // Pages shown: first, last, current ± 1 - deduped and sorted.
  const pagesToShow = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const sortedPages = [...pagesToShow].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const items: ReactNode[] = [];
  items.push(
    <button
      key="prev"
      type="button"
      className="page-btn"
      disabled={currentPage === 1}
      aria-label={t("btn_prev")}
      onClick={() => onPageChange(currentPage - 1)}
    >
      &#8249;
    </button>,
  );

  let lastRendered = 0;
  for (const p of sortedPages) {
    if (lastRendered && p - lastRendered > 1) {
      items.push(<span key={`ellipsis-${p}`} className="page-ellipsis">…</span>);
    }
    items.push(
      <button
        key={p}
        type="button"
        className={`page-btn${p === currentPage ? " active" : ""}`}
        aria-current={p === currentPage ? "page" : undefined}
        onClick={() => onPageChange(p)}
      >
        {p}
      </button>,
    );
    lastRendered = p;
  }

  items.push(
    <button
      key="next"
      type="button"
      className="page-btn"
      disabled={currentPage === totalPages}
      aria-label={t("btn_next")}
      onClick={() => onPageChange(currentPage + 1)}
    >
      &#8250;
    </button>,
  );

  return <div className="pagination">{items}</div>;
}
