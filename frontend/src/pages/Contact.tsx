import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/usePageTitle";
import { CONTACT_EMAIL } from "../lib/utils";

export default function Contact() {
  const { t } = useTranslation();
  usePageTitle("page_title_contact");
  return (
    <div className="container">
      <div className="static-page">
        <h1>{t("contact_title")}</h1>
        <p className="static-lead">{t("contact_body1")}</p>
        <p>
          {t("contact_body2")}{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
