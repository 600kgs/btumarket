import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/usePageTitle";

export default function Safety() {
  const { t } = useTranslation();
  usePageTitle("page_title_safety");
  return (
    <div className="container">
      <div className="static-page">
        <h1>{t("safety_page_title")}</h1>
        <p className="static-lead">{t("safety_lead")}</p>
        <ul className="safety-list">
          <li>{t("safety_tip1")}</li>
          <li>{t("safety_tip2")}</li>
          <li>{t("safety_tip3")}</li>
          <li>{t("safety_tip4")}</li>
        </ul>
      </div>
    </div>
  );
}
