import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "../lib/usePageTitle";

export default function HowItWorks() {
  const { t } = useTranslation();
  usePageTitle("page_title_how");
  return (
    <div className="container">
      <div className="static-page">
        <h1>{t("how_title")}</h1>
        <ol className="how-steps">
          <li>
            <h3>{t("how_step1_title")}</h3>
            <p>{t("how_step1_text")}</p>
          </li>
          <li>
            <h3>{t("how_step2_title")}</h3>
            <p>{t("how_step2_text")}</p>
          </li>
          <li>
            <h3>{t("how_step3_title")}</h3>
            <p>{t("how_step3_text")}</p>
          </li>
        </ol>
        <Link className="static-cta" to="/register">{t("how_cta")}</Link>
      </div>
    </div>
  );
}
