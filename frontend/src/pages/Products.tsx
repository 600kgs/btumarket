import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { CATEGORIES, catLabel, type Listing } from "../lib/utils";
import { usePageTitle } from "../lib/usePageTitle";
import CategoryIcon from "../components/CategoryIcon";
import ListingCard from "../components/ListingCard";
import CardSkeleton from "../components/CardSkeleton";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";

const PRICE_CAP = 100000;

interface SearchState {
  q: string;
  category: string;
  sort: string;
  minPrice: string;
  maxPrice: string;
  page: number;
}

const DEFAULT_SEARCH: SearchState = { q: "", category: "", sort: "newest", minPrice: "", maxPrice: "", page: 1 };

function clampPrice(val: string): string {
  if (val === "") return "";
  let n = parseFloat(val);
  if (isNaN(n)) return "";
  n = Math.min(Math.max(n, 0), PRICE_CAP);
  return String(n);
}

// The full browse/search grid. Reached from the homepage's header search,
// category tiles/quick-links, and every "View all" link - each arrives with
// URL params (?q= / ?category= / ?sort= / ?free=1) that seed the filters;
// further filtering after that is managed locally.
export default function Products() {
  const { t } = useTranslation();
  usePageTitle("page_title_index");
  const { isLoggedIn } = useAuth();

  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [search, setSearch] = useState<SearchState>(DEFAULT_SEARCH);

  const [results, setResults] = useState<Listing[]>([]);
  const [count, setCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [searchParams] = useSearchParams();

  // Seed the filters from the URL each time it changes (header search,
  // category link, a "View all" with ?sort=). free=1 is a max-price-0
  // shortcut, sort passes straight through.
  useEffect(() => {
    const q = searchParams.get("q") || "";
    const category = searchParams.get("category") || "";
    const sort = searchParams.get("sort") || "newest";
    const free = searchParams.get("free") === "1";
    if (free) setMaxInput("0");
    setSearch((prev) => {
      const maxPrice = free ? "0" : prev.maxPrice;
      return prev.q === q && prev.category === category && prev.sort === sort && prev.maxPrice === maxPrice
        ? prev
        : { ...prev, q, category, sort, maxPrice, page: 1 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Debounce the price inputs into the committed search (category/sort/page
  // commit immediately through setSearch).
  useEffect(() => {
    const id = setTimeout(() => {
      const clampedMin = clampPrice(minInput);
      const clampedMax = clampPrice(maxInput);
      if (clampedMin !== minInput) setMinInput(clampedMin);
      if (clampedMax !== maxInput) setMaxInput(clampedMax);
      let min = clampedMin;
      let max = clampedMax;
      if (min && max && parseFloat(min) > parseFloat(max)) {
        [min, max] = [max, min];
        setMinInput(min);
        setMaxInput(max);
      }
      setSearch((prev) =>
        prev.minPrice === min && prev.maxPrice === max ? prev : { ...prev, minPrice: min, maxPrice: max, page: 1 },
      );
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minInput, maxInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let url = `${API}/search?q=${encodeURIComponent(search.q)}&page=${search.page}&sort=${search.sort}`;
        if (search.category) url += `&category=${encodeURIComponent(search.category)}`;
        if (search.minPrice) url += `&min_price=${encodeURIComponent(search.minPrice)}`;
        if (search.maxPrice) url += `&max_price=${encodeURIComponent(search.maxPrice)}`;
        const res = await authFetch(url);
        const data = await res.json();
        if (cancelled) return;
        setResults(data.results);
        setTotalPages(data.pages);
        setCount(data.count);
        window.scrollTo(0, 0);
      } catch (err) {
        console.error("Error loading listings:", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  // The category filter holds a comma-separated list, so a shared link and
  // the homepage tiles (which send a single one) keep working unchanged.
  const selectedCategories = search.category ? search.category.split(",") : [];

  function toggleCategory(category: string) {
    setSearch((prev) => {
      const current = prev.category ? prev.category.split(",") : [];
      const next = current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category];
      return { ...prev, category: next.join(","), page: 1 };
    });
  }

  function clearCategories() {
    setSearch((prev) => ({ ...prev, category: "", page: 1 }));
  }

  function handleSortChange(sort: string) {
    setSearch((prev) => ({ ...prev, sort, page: 1 }));
  }

  function handleClear() {
    setMinInput("");
    setMaxInput("");
    setSearch(DEFAULT_SEARCH);
  }

  function goToPage(page: number) {
    setSearch((prev) => ({ ...prev, page }));
  }

  const [searchSaved, setSearchSaved] = useState(false);
  const [savedList, setSavedList] = useState<{ query: string; category: string }[]>([]);
  useEffect(() => {
    setSearchSaved(false);
  }, [search.q, search.category]);

  // Load the user's saved searches so the button can show "already saved" when
  // the current query/category exactly matches one they've saved before.
  useEffect(() => {
    if (!isLoggedIn) return;
    authFetch(`${API}/me/saved-searches`)
      .then((r) => r.json())
      .then((d) => setSavedList(d.saved || []))
      .catch(() => {});
  }, [isLoggedIn]);

  async function handleSaveSearch() {
    const res = await authFetch(`${API}/me/saved-searches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: search.q, category: search.category }),
    });
    if (res.ok) {
      setSearchSaved(true);
      setSavedList((prev) => [...prev, { query: search.q.trim(), category: search.category }]);
    } else {
      const data = await res.json().catch(() => null);
      alert(formatErrorDetail(data));
    }
  }

  const canSaveSearch = isLoggedIn && !!(search.q || search.category);
  // True when the current filters exactly match a search the user already saved.
  const isCurrentSaved = savedList.some(
    (s) => s.query === search.q.trim() && (s.category || "") === (search.category || ""),
  );
  const showSaved = searchSaved || isCurrentSaved;

  const chips: { label: string; onClear: () => void }[] = [];
  if (search.q) chips.push({ label: `"${search.q}"`, onClear: () => setSearch((p) => ({ ...p, q: "", page: 1 })) });
  for (const cat of selectedCategories) {
    chips.push({ label: catLabel(cat, t), onClear: () => toggleCategory(cat) });
  }
  if (search.minPrice) chips.push({ label: t("chip_min", { n: search.minPrice }), onClear: () => { setMinInput(""); setSearch((p) => ({ ...p, minPrice: "", page: 1 })); } });
  if (search.maxPrice) chips.push({ label: t("chip_max", { n: search.maxPrice }), onClear: () => { setMaxInput(""); setSearch((p) => ({ ...p, maxPrice: "", page: 1 })); } });
  if (search.sort !== "newest") chips.push({ label: t("sort_" + search.sort), onClear: () => handleSortChange("newest") });

  return (
    <div className="container">
      <div className={`search-panel${filtersOpen ? " filters-open" : ""}`}>
        <button
          type="button"
          className="filter-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          <span>{t("btn_filters")}</span>
          <svg className="filter-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="sort">{t("filter_sort")}</label>
            <select id="sort" value={search.sort} onChange={(e) => handleSortChange(e.target.value)}>
              <option value="newest">{t("sort_newest")}</option>
              <option value="oldest">{t("sort_oldest")}</option>
              <option value="price_low">{t("sort_price_low")}</option>
              <option value="price_high">{t("sort_price_high")}</option>
              <option value="title_az">{t("sort_title_az")}</option>
              <option value="most_viewed">{t("sort_most_viewed")}</option>
            </select>
          </div>

          <div className="filter-group">
            <label>{t("filter_price")}</label>
            <div className="price-range">
              <input
                type="number"
                min={0}
                max={100000}
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch((p) => ({ ...p, minPrice: clampPrice(minInput), page: 1 })); }}
                placeholder={t("min_placeholder")}
              />
              <span className="price-sep">–</span>
              <input
                type="number"
                min={0}
                max={100000}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch((p) => ({ ...p, maxPrice: clampPrice(maxInput), page: 1 })); }}
                placeholder={t("max_placeholder")}
              />
              <span className="price-currency">₾</span>
            </div>
          </div>

          <button className="clear-filters" type="button" onClick={handleClear}>
            {t("btn_clear")}
          </button>
        </div>

        {chips.length > 0 && (
          <div className="active-filters">
            {chips.map((chip, i) => (
              <span key={i} className="filter-chip">
                {chip.label}
                <button type="button" onClick={chip.onClear} aria-label="Remove filter">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="category-tiles">
        <button
          type="button"
          className="tile tile-all"
          aria-current={selectedCategories.length === 0 || undefined}
          onClick={clearCategories}
        >
          <span>{t("tile_all")}</span>
          <svg className="tile-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className="tile"
            data-category={cat}
            aria-pressed={selectedCategories.includes(cat)}
            aria-current={selectedCategories.includes(cat) || undefined}
            onClick={() => toggleCategory(cat)}
          >
            <span>{catLabel(cat, t)}</span>
            <CategoryIcon name={cat} className="tile-icon" />
          </button>
        ))}
        <button
          type="button"
          className="tile tile-free"
          aria-current={search.maxPrice === "0" || undefined}
          onClick={() => {
            setMaxInput("0");
            setSearch((prev) => ({ ...prev, maxPrice: "0", page: 1 }));
          }}
        >
          <span>{t("cat_free")}</span>
          <CategoryIcon name="free" className="tile-icon" />
        </button>
      </div>

      <div className="results-meta">
        <span>
          {count === 0 ? t("no_results") : count === 1 ? t("results_found_one") : t("results_found_other", { count })}
        </span>
        {canSaveSearch && (
          <button
            type="button"
            className={`save-search-btn${showSaved ? " saved" : ""}`}
            disabled={showSaved}
            onClick={handleSaveSearch}
          >
            {showSaved ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {t("search_saved")}
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {t("btn_save_search")}
              </>
            )}
          </button>
        )}
      </div>

      <div className="listings-grid">
        {!loaded ? (
          Array.from({ length: 20 }).map((_, i) => <CardSkeleton key={i} />)
        ) : results.length === 0 ? (
          <EmptyState
            icon={
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            }
            title={t("no_results")}
            action={<button type="button" onClick={handleClear}>{t("empty_clear")}</button>}
          />
        ) : (
          results.map((listing) => <ListingCard key={listing.id} listing={listing} />)
        )}
      </div>

      <Pagination totalPages={totalPages} currentPage={search.page} onPageChange={goToPage} />
    </div>
  );
}
