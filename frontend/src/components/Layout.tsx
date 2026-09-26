import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { closeKeyboardRoom, openKeyboardRoom } from "../lib/keyboard";
import Nav from "./Nav";
import Footer from "./Footer";
import EntryDisclaimer from "./EntryDisclaimer";

export default function Layout() {
  const { t } = useTranslation();
  const location = useLocation();

  // React Router doesn't scroll to top on navigation by default (only full
  // page loads do that natively) - without this, clicking from partway down
  // a long results/detail page to another page lands you partway down the
  // new page too, which reads as broken on mobile especially. Keyed on
  // location.key, not just pathname - listing-to-listing (via "similar
  // listings") and any other same-route-different-query navigation (e.g.
  // /listing/80 -> /listing/81) never changes pathname, so
  // that alone missed exactly the case a reader would notice most.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.key]);

  // Every text field on the site, one place (see lib/keyboard.ts, which
  // ignores devices without an on-screen keyboard).
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        openKeyboardRoom(el);
      }
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", closeKeyboardRoom);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", closeKeyboardRoom);
      closeKeyboardRoom();
    };
  }, []);

  return (
    <>
      <EntryDisclaimer />
      <div className="promo-strip">
        <div className="promo-strip-inner">
          <span>{t("strip_text")}</span>
          <Link to="/post">{t("strip_cta")}</Link>
        </div>
      </div>
      <Nav />
      <Outlet />
      <Footer />
    </>
  );
}
