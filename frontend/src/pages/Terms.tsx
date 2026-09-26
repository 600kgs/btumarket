import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/usePageTitle";
import { CONTACT_EMAIL } from "../lib/utils";

// Sections are keyed so both languages stay in lockstep; add a key pair to
// add a section.
const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
const LAST_UPDATED = "2026-07-30";

export default function Terms() {
  const { t } = useTranslation();
  usePageTitle("page_title_terms");
  return (
    <div className="container">
      <div className="static-page legal-page">
        <h1>{t("terms_title")}</h1>
        <p className="legal-updated">{t("legal_updated", { date: LAST_UPDATED })}</p>
        <p className="legal-intro">{t("terms_intro")}</p>
        {SECTIONS.map((s) => (
          <section key={s}>
            <h3>{t(`terms_${s}_title`)}</h3>
            <p>{t(`terms_${s}_text`)}</p>
          </section>
        ))}
        <p className="legal-contact">
          {t("terms_contact")}{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
