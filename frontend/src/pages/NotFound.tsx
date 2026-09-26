import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/usePageTitle";
import EmptyState from "../components/EmptyState";

const compassIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

// Catch-all for URLs that match no route. The server already answers these
// with a 404 status (see the backend's SPA fallback) - this is the human
// half of that: something friendlier than a blank page under the header.
export default function NotFound() {
  const { t } = useTranslation();
  usePageTitle("page_title_not_found");
  return (
    <div className="container">
      <EmptyState
        icon={compassIcon}
        title={t("not_found_title")}
        action={<Link to="/" className="empty-cta">{t("link_go_home")}</Link>}
      />
    </div>
  );
}
