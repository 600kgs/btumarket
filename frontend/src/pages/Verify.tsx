import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";

export default function Verify() {
  const { t } = useTranslation();
  usePageTitle("page_title_verify");
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();

  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleVerify() {
    if (submitting) return;
    setSubmitting(true);

    const res = await fetch(`${API}/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();

    if (res.ok) {
      setError(null);
      if (data.access_token) {
        login(data.username, data.access_token);
        setSuccess(t("verify_success"));
        setTimeout(() => navigate("/"), 1200);
      } else {
        // Already-verified edge case (e.g. clicked an old link twice) - no
        // fresh token issued, send them to log in normally.
        setSuccess(t("verify_success"));
        setTimeout(() => navigate("/login"), 1500);
      }
    } else {
      setError(formatErrorDetail(data, t("register_failed_default")));
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError(t("error_fill_fields"));
      return;
    }
    const res = await fetch(`${API}/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      setError(null);
      setSuccess(t("code_sent"));
    } else {
      setError(formatErrorDetail(data, t("register_failed_default")));
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h2>{t("verify_title")}</h2>
        <p className="auth-subtitle">{t("verify_subtitle")}</p>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("ph_email")} />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("ph_code")}
          />
          <button type="submit" className="form-btn" disabled={submitting}>
            {t("btn_verify")}
          </button>
        </form>

        <p className="auth-link" style={{ marginBottom: 10 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleResend(); }}>
            {t("resend_code")}
          </a>
        </p>
        <p className="auth-link">
          <Link to="/login">{t("link_login")}</Link>
        </p>
      </div>
    </div>
  );
}
