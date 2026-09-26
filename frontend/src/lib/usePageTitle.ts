import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// Sets document.title from a translation key and keeps it in sync when
// the language changes while the page is open.
export function usePageTitle(key: string) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, i18n.language]);
}
