import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePolling } from "../lib/usePolling";
import { CATEGORIES, catLabel } from "../lib/utils";
import LangToggle from "./LangToggle";
import NotificationBell from "./NotificationBell";
import { FavoriteHeartIcon, NavMessageIcon } from "./icons";

// Polls the unread-message count every 15s while the tab is visible. Plain
// fetch, not authFetch: an expired token while browsing a public page should
// mean no badge, not a redirect to login.
function useUnreadCount(token: string | null): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!token) setUnread(0);
  }, [token]);

  usePolling(
    async () => {
      try {
        const res = await fetch(`${API}/messages-unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setUnread(data.unread);
      } catch {
        // offline / backend down - badge just stays as it was
      }
    },
    15000,
    !!token,
  );

  return unread;
}

export default function Nav() {
  const { t } = useTranslation();
  const { username, token, isLoggedIn, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(token);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchCat, setSearchCat] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const catRef = useRef<HTMLDivElement>(null);

  // Header search sends the query/category to the /products grid as URL
  // params - Products owns the actual search state and reads them from there.
  // Keeps this component stateless about results and works from any page.
  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQ.trim()) params.set("q", searchQ.trim());
    if (searchCat) params.set("category", searchCat);
    navigate(`/products${params.size ? "?" + params.toString() : ""}`);
  }

  // Close the avatar dropdown on an outside click - only bound while open,
  // so pages that never open it never pay for a global listener.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        avatarBtnRef.current &&
        !avatarBtnRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [dropdownOpen]);

  // Same outside-click close for the custom category dropdown.
  useEffect(() => {
    if (!catOpen) return;
    function onClick(e: MouseEvent) {
      if (catRef.current && !catRef.current.contains(e.target as Node)) {
        setCatOpen(false);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [catOpen]);

  // Opening the mobile menu pushes a history entry, so the phone's back
  // button closes the menu instead of leaving the page. Closing it any other
  // way consumes that entry again. Router state is spread through untouched.
  useEffect(() => {
    if (!mobileOpen) return;
    window.history.pushState({ ...window.history.state, navMenu: true }, "");
    const onPop = () => setMobileOpen(false);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (window.history.state?.navMenu) window.history.back();
    };
  }, [mobileOpen]);

  const isActive = (path: string) => location.pathname === path;
  const navLinkClass = (path: string) => (isActive(path) ? "active" : "");

  async function handleLogout() {
    // authFetch not needed here - logout doesn't hit an endpoint, just
    // clears local state - but keep the same redirect target as before.
    logout();
    window.location.href = "/";
  }

  // Just the first name in the account pill - full usernames are the person's
  // whole Title-Case name (e.g. "Otaritomas Sepashvili"), too long for the bar;
  // the CSS caps it with an ellipsis as a second guard.
  const firstName = (username || "").trim().split(/\s+/)[0] || "";

  return (
    <nav className={mobileOpen ? "nav-open" : ""}>
      <div className="nav-inner">
        <Link
          to="/"
          className="logo"
          onClick={(e) => {
            // Plain left-click forces a fresh navigation so the homepage
            // resets to browse mode even from a bare "/" (same-URL <Link>s
            // don't re-navigate). Modifier/middle clicks fall through so
            // open-in-new-tab still works.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            setMobileOpen(false);
            navigate("/");
          }}
        >
          btumarket<span className="logo-ge">.ge</span>
        </Link>
        <form className="nav-search" role="search" onSubmit={submitSearch}>
          {/* Custom dropdown (not a native <select>) so the caret can flip up
              on open and it matches the account pill's styling. */}
          <div className="nav-cat-wrap" ref={catRef}>
            <button
              type="button"
              className={`nav-search-cat${catOpen ? " open" : ""}`}
              onClick={() => setCatOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={catOpen}
              aria-label={t("filter_category")}
            >
              <span className="nav-cat-current">{searchCat ? catLabel(searchCat, t) : t("opt_all")}</span>
              <span className="nav-caret" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
            {catOpen && (
              <div className="nav-cat-menu" role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={searchCat === ""}
                  className={`nav-cat-opt${searchCat === "" ? " sel" : ""}`}
                  onClick={() => { setSearchCat(""); setCatOpen(false); }}
                >
                  {t("opt_all")}
                </button>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    role="option"
                    aria-selected={searchCat === cat}
                    className={`nav-cat-opt${searchCat === cat ? " sel" : ""}`}
                    onClick={() => { setSearchCat(cat); setCatOpen(false); }}
                  >
                    {catLabel(cat, t)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t("search_placeholder")}
          />
          <button type="submit" className="nav-search-go">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span>{t("btn_search")}</span>
          </button>
        </form>
        <div className="nav-right">
          {/* Bar level, not inside .nav-links, so it stays visible on mobile
              instead of collapsing into the hamburger. */}
          {isLoggedIn && <NotificationBell />}
          {/* Tapping any nav link closes the mobile menu. */}
          <div className="nav-links" onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}>
            {isLoggedIn ? (
              <>
                <Link
                  to="/favorites"
                  className={`nav-icon-btn ${navLinkClass("/favorites")}`}
                  aria-label={t("nav_favorites")}
                  title={t("nav_favorites")}
                >
                  <FavoriteHeartIcon />
                  <span className="nav-icon-label">{t("nav_favorites")}</span>
                </Link>

                <Link
                  to="/messages"
                  className={`nav-icon-btn ${navLinkClass("/messages")}`}
                  aria-label={t("nav_messages")}
                  title={t("nav_messages")}
                >
                  <NavMessageIcon />
                  <span className="nav-icon-label">{t("nav_messages")}</span>
                  {unread > 0 && <span className="nav-badge">{unread > 9 ? "9+" : unread}</span>}
                </Link>

                <div className="nav-user-menu">
                  <button
                    ref={avatarBtnRef}
                    type="button"
                    className={`nav-avatar-btn${dropdownOpen ? " open" : ""}`}
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    aria-expanded={dropdownOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropdownOpen((v) => !v);
                    }}
                  >
                    <span className="nav-avatar-name">{firstName}</span>
                    {/* Caret in a span wrapper so it rotates reliably (a CSS
                        transform on the bare <svg> didn't render). Flips up
                        while the account menu is open. */}
                    <span className="nav-caret" aria-hidden="true">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  <div ref={dropdownRef} className={`nav-dropdown${dropdownOpen ? " open" : ""}`}>
                    <div className="nav-dropdown-name">{username}</div>
                    <Link to="/mylistings" className={navLinkClass("/mylistings")}>
                      {t("nav_mylistings")}
                    </Link>
                    <Link to="/settings" className={navLinkClass("/settings")}>
                      {t("nav_settings")}
                    </Link>
                    <div className="nav-dropdown-divider" />
                    <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
                      {t("nav_logout")}
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Link to="/login" className={navLinkClass("/login")}>
                  {t("nav_login")}
                </Link>
                <Link to="/register" className={navLinkClass("/register")}>
                  {t("link_register")}
                </Link>
              </>
            )}
            {/* On narrow screens the bar-level language pill doesn't fit -
                it moves into this menu instead (CSS decides which shows). */}
            <div className="nav-links-lang">
              <LangToggle />
            </div>
          </div>
          {/* A quiet globe just left of the primary CTA so the red Post button
              stays the far-right anchor (on narrow screens it moves into the
              hamburger menu above instead). */}
          <LangToggle />
          <Link to="/post" className="nav-post-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{t("nav_post")}</span>
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-label="Menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        </div>
      </div>
      <div className="nav-catrow">
        <div className="nav-catrow-inner">
          <Link to="/products" className="nav-cat-hot">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2c1 4-2 5-2 8a2 2 0 1 0 4 0c0-1 .5-2 1-3 2 2 3 4 3 6a6 6 0 0 1-12 0c0-5 5-7 6-11Z" />
            </svg>
            {t("nav_fresh")}
          </Link>
          {/* A few academic-first quick-links on the left - the full category
              list lives in the search dropdown and the homepage tiles. Georgian
              category words run long, so keep this short to leave room for the
              How it works / Safety / Contact links on the right. */}
          {["textbooks", "notes", "services"].map((cat) => (
            <Link key={cat} to={`/products?category=${cat}`}>
              {catLabel(cat, t)}
            </Link>
          ))}
          <Link to="/products?free=1">{t("cat_free")}</Link>
          <span className="nav-catrow-spacer" />
          <Link to="/how-it-works">{t("nav_how")}</Link>
          <Link to="/safety">{t("nav_safety")}</Link>
          <Link to="/contact">{t("nav_contact")}</Link>
        </div>
      </div>
    </nav>
  );
}
