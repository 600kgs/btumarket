import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import PasswordField, { usePasswordVisibility } from "../components/PasswordField";
import GoogleSignIn from "../components/GoogleSignIn";

export default function Register() {
  const { t } = useTranslation();
  usePageTitle("page_title_register");
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Password + confirm-password share one visibility toggle, matching the
  // old addPasswordToggle(id, [linkedIds]) behavior.
  const passwordVisibility = usePasswordVisibility();

  async function handleRegister() {
    if (submitting) return;

    if (!agreed) {
      setError(t("error_must_agree"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("error_passwords_mismatch"));
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, phone, password }),
    });
    const data = await res.json();

    if (res.ok) {
      if (data.verification_required) {
        setSuccess(t("register_check_email", { username: data.username }));
        setTimeout(() => navigate(`/verify?email=${encodeURIComponent(email)}`), 1200);
      } else {
        login(data.username, data.access_token);
        setSuccess(t("register_success", { username: data.username }));
        setTimeout(() => navigate("/"), 1200);
      }
    } else {
      setError(formatErrorDetail(data, t("register_failed_default")));
      setSubmitting(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    // second guard alongside the dimmed wrapper; Google's button has no
    // disabled prop
    if (!agreed) {
      setError(t("error_must_agree"));
      return;
    }
    const res = await fetch(`${API}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json();
    if (res.ok) {
      login(data.username, data.access_token);
      navigate("/");
    } else if (data.detail === "account_banned") {
      setError(t("account_banned"));
    } else {
      setError(formatErrorDetail(data, t("err_google_signin_failed")));
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h2>{t("register_title")}</h2>
        <p className="auth-subtitle">{t("register_subtitle")}</p>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <form onSubmit={(e) => { e.preventDefault(); handleRegister(); }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("ph_email_register")} />
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("ph_phone")} />
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            placeholder={t("ph_password")}
            {...passwordVisibility}
          />
          <PasswordField
            id="confirm-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder={t("ph_confirm_password")}
            {...passwordVisibility}
          />
          <label className="agree-terms-row">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              {t("agree_terms_prefix")}{" "}
              <Link to="/terms" target="_blank">{t("nav_terms")}</Link>
              {" "}{t("agree_terms_and")}{" "}
              <Link to="/privacy" target="_blank">{t("nav_privacy")}</Link>
            </span>
          </label>

          <button type="submit" className="form-btn" disabled={submitting || !agreed}>
            {t("btn_register")}
          </button>
        </form>

        <p className="auth-link">
          <span>{t("already_have_account")}</span> <Link to="/login">{t("link_login")}</Link>
        </p>

        <div style={{ opacity: agreed ? 1 : 0.45, pointerEvents: agreed ? "auto" : "none" }}>
          <GoogleSignIn onCredential={handleGoogleCredential} />
        </div>
        {!agreed && <p className="agree-terms-hint">{t("agree_terms_hint")}</p>}
      </div>
    </div>
  );
}
