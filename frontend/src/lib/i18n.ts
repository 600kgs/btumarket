// i18next setup. Georgian by default, preference saved under the "lang"
// localStorage key, single-brace {placeholder} interpolation to match the
// translation strings (i18next's own default is double-brace) - configuring
// this means en.json/ka.json could be near-mechanical copies of the
// original strings instead of needing every brace doubled by hand.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import ka from "../locales/ka.json";

const STORAGE_KEY = "lang";

function getSavedLang(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "ka" ? saved : "ka";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ka: { translation: ka },
  },
  lng: getSavedLang(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes - i18next doesn't need to
    prefix: "{",
    suffix: "}",
  },
});

export function setLang(lang: "en" | "ka") {
  localStorage.setItem(STORAGE_KEY, lang);
  i18n.changeLanguage(lang);
}

export function getLang(): "en" | "ka" {
  return i18n.language === "en" ? "en" : "ka";
}

export default i18n;
