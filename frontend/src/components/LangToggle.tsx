import { getLang, setLang } from "../lib/i18n";
import { useTranslation } from "react-i18next";

// A quiet globe icon that switches to the OTHER language on click - only two
// languages, so a single toggle is enough. Icon (not text) keeps it neutral
// and unambiguous at the far right of the header; the title/aria-label name
// the language it switches to for screen readers and on hover.
export default function LangToggle() {
  // useTranslation() subscribes this component to i18next's "languageChanged"
  // event and re-renders it automatically - that's the only reason it's
  // called here, getLang()/setLang() do the real work.
  useTranslation();
  const lang = getLang();
  const other = lang === "ka" ? "en" : "ka";
  const fullName = other === "en" ? "English" : "ქართული";

  return (
    <button
      type="button"
      className="lang-switch"
      onClick={() => setLang(other)}
      aria-label={`Switch language to ${fullName}`}
      title={fullName}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.6 2.7 3.9 5.9 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.9-3.9-9s1.3-6.3 3.9-9Z" />
      </svg>
    </button>
  );
}
