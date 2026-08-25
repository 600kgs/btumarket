import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Gates first-time use of the whole site, not just registration - BTU's
// legal office asked for a notice shown on entry, not something a visitor
// can browse past without seeing. Acknowledgement is remembered per
// browser so it doesn't nag on every visit.
const STORAGE_KEY = "btu_disclaimer_ack";

export default function EntryDisclaimer() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  if (!visible) return null;

  function accept() {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="entry-disclaimer-overlay" role="dialog" aria-modal="true" aria-labelledby="entry-disclaimer-title">
      <div className="entry-disclaimer-card">
        <h2 id="entry-disclaimer-title">{t("entry_disclaimer_title")}</h2>
        <p>{t("entry_disclaimer_body")}</p>
        <label className="agree-terms-row">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            {t("agree_terms_prefix")}{" "}
            <Link to="/terms" target="_blank">{t("nav_terms")}</Link>
            {" "}{t("agree_terms_and")}{" "}
            <Link to="/privacy" target="_blank">{t("nav_privacy")}</Link>
          </span>
        </label>
        <button type="button" className="form-btn" disabled={!agreed} onClick={accept}>
          {t("entry_disclaimer_continue")}
        </button>
      </div>
    </div>
  );
}
