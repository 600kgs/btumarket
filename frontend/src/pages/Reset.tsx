import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, formatErrorDetail } from "../lib/api";
import { usePageTitle } from "../lib/usePageTitle";
import PasswordField, { usePasswordVisibility } from "../components/PasswordField";

export default function Reset() {
  const { t } = useTranslation();
  usePageTitle("page_title_reset");
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [step2Visible, setStep2Visible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const passwordVisibility = usePasswordVisibility();

  async function handleSendCode() {
    if (!email) {
      setError(t("error_fill_fields"));
      return;
    }
    const res = await fetch(`${API}/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      setError(null);
      setSuccess(t("code_sent"));
      setStep2Visible(true);
    } else {
      setError(formatErrorDetail(data, t("register_failed_default")));
    }
  }

  async function handleResetPassword() {
    if (submitting) return;
    if (!email || !code || !newPassword) {
      setError(t("error_fill_fields"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("error_passwords_mismatch"));
      return;
    }
    setSubmitting(true);

    const res = await fetch(`${API}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, new_password: newPassword }),
    });
    const data = await res.json();

    if (res.ok) {
      setError(null);
      setSuccess(t("reset_success"));
      setTimeout(() => navigate("/login"), 1500);
    } else {
      setError(formatErrorDetail(data, t("register_failed_default")));
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h2>{t("reset_title")}</h2>
        <p className="auth-subtitle">{t("reset_subtitle")}</p>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("ph_email")} />
          {!step2Visible && (
            <button type="submit" className="form-btn">
              {t("btn_send_code")}
            </button>
          )}
        </form>

        {step2Visible && (
          <form onSubmit={(e) => { e.preventDefault(); handleResetPassword(); }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("ph_code")}
            />
            <PasswordField
              id="new-password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder={t("ph_new_password")}
              {...passwordVisibility}
            />
            <PasswordField
              id="confirm-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder={t("ph_confirm_password")}
              {...passwordVisibility}
            />
            <button type="submit" className="form-btn" disabled={submitting}>
              {t("btn_reset")}
            </button>
          </form>
        )}

        <p className="auth-link">
          <Link to="/login">{t("link_login")}</Link>
        </p>
      </div>
    </div>
  );
}
