import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import PasswordField, { usePasswordVisibility } from "../components/PasswordField";
import GoogleSignIn from "../components/GoogleSignIn";

export default function Login() {
  const { t } = useTranslation();
  usePageTitle("page_title_login");
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<React.ReactNode>(() => {
    if (params.get("expired") === "1") return t("session_expired");
    if (params.get("banned") === "1") return t("account_banned");
    if (params.get("reason") === "login_required") return t("login_required");
    return null;
  });
  // Arriving right after a deliberate password change is a success, not an
  // error - green text instead of the red banner.
  const notice = params.get("pwchanged") === "1" ? t("pw_changed_login") : null;
  const passwordField = usePasswordVisibility();

  function goNext() {
    navigate(next ? decodeURIComponent(next) : "/");
  }

  async function handleLogin() {
    if (submitting) return; // guard against double-clicks / button-mashing
    setSubmitting(true);

    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok) {
      login(data.username, data.access_token);
      goNext();
      return;
    }

    if (data.detail === "email_not_verified") {
      setError(
        <>
          {t("email_not_verified")}{" "}
          <Link to="/verify" style={{ color: "var(--accent)", fontWeight: 600 }}>
            {t("verify_link")}
          </Link>
        </>,
      );
    } else if (data.detail === "account_banned") {
      setError(t("account_banned"));
    } else {
      setError(formatErrorDetail(data));
    }
    setSubmitting(false);
  }

  async function handleGoogleCredential(credential: string) {
    const res = await fetch(`${API}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json();
    if (res.ok) {
      login(data.username, data.access_token);
      goNext();
    } else if (data.detail === "account_banned") {
      setError(t("account_banned"));
    } else {
      setError(formatErrorDetail(data, t("err_google_signin_failed")));
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h2>{t("login_title")}</h2>
        <p className="auth-subtitle">{t("login_subtitle")}</p>

        {notice && !error && <div className="success-msg">{notice}</div>}
        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("ph_username_or_email")}
          />
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            placeholder={t("ph_password_login")}
            {...passwordField}
          />
          <button type="submit" className="form-btn" disabled={submitting}>
            {t("btn_login")}
          </button>
        </form>

        <p className="auth-link" style={{ marginBottom: 10 }}>
          <Link to="/reset">{t("forgot_password")}</Link>
        </p>
        <p className="auth-link">
          <span>{t("no_account")}</span> <Link to="/register">{t("link_register")}</Link>
        </p>

        <GoogleSignIn onCredential={handleGoogleCredential} />
      </div>
    </div>
  );
}
