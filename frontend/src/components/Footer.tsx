import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/AuthContext";

export default function Footer() {
  const { t } = useTranslation();
  const { isLoggedIn } = useAuth();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="logo">
            btumarket<span className="logo-ge">.ge</span>
          </Link>
          <p>{t("footer_tagline")}</p>
        </div>
        <div className="footer-col">
          <h4>{t("footer_links_title")}</h4>
          <Link to="/products">{t("nav_browse")}</Link>
          <Link to="/post">{t("nav_post")}</Link>
          <Link to="/messages">{t("nav_messages")}</Link>
        </div>
        <div className="footer-col">
          <h4>{t("footer_account_title")}</h4>
          {isLoggedIn ? (
            <>
              <Link to="/mylistings">{t("nav_mylistings")}</Link>
              <Link to="/favorites">{t("nav_favorites")}</Link>
              <Link to="/settings">{t("nav_settings")}</Link>
            </>
          ) : (
            <>
              <Link to="/login">{t("nav_login")}</Link>
              <Link to="/register">{t("link_register")}</Link>
            </>
          )}
        </div>
        <div className="footer-col">
          <h4>{t("footer_help_title")}</h4>
          <Link to="/how-it-works">{t("nav_how")}</Link>
          <Link to="/safety">{t("nav_safety")}</Link>
          <Link to="/contact">{t("nav_contact")}</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>{t("footer_copyright")}</span>
          <span className="footer-legal">
            <Link to="/terms">{t("nav_terms")}</Link>
            <Link to="/privacy">{t("nav_privacy")}</Link>
          </span>
          <span className="footer-verify">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {t("footer_verified")}
          </span>
        </div>
        <div className="footer-disclaimer">{t("footer_disclaimer")}</div>
      </div>
    </footer>
  );
}
