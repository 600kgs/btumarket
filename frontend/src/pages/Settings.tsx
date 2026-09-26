import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { catLabel } from "../lib/utils";
import PasswordField, { usePasswordVisibility } from "../components/PasswordField";

interface SavedSearch {
  id: number;
  query: string;
  category: string;
}

type Feedback = { ok: boolean; text: string } | null;

export default function Settings() {
  const { t } = useTranslation();
  usePageTitle("page_title_settings");
  const navigate = useNavigate();
  const { token, logout } = useAuth();

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<Feedback>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const pwFields = usePasswordVisibility();

  const [phone, setPhone] = useState("");
  const [phoneMsg, setPhoneMsg] = useState<Feedback>(null);

  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);

  const [deletePw, setDeletePw] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<Feedback>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteField = usePasswordVisibility();

  useEffect(() => {
    if (!token) {
      navigate("/login?reason=login_required&next=/settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [savedRes, blocksRes] = await Promise.all([
          authFetch(`${API}/me/saved-searches`),
          authFetch(`${API}/me/blocks`),
        ]);
        if (savedRes.ok) setSaved((await savedRes.json()).saved || []);
        if (blocksRes.ok) setBlocked((await blocksRes.json()).blocked || []);
      } catch {
        // authFetch already redirected on a dead session; anything else
        // just leaves the two lists empty.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwSubmitting) return;
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: t("error_passwords_mismatch") });
      return;
    }
    setPwSubmitting(true);
    const res = await authFetch(`${API}/me/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
    });
    if (res.ok) {
      // The backend invalidated every token, including the one this page is
      // logged in with - go to login cleanly instead of waiting for the
      // next request to bounce there with a scary "session expired".
      logout();
      window.location.href = "/login?pwchanged=1";
      return;
    }
    const data = await res.json().catch(() => null);
    setPwMsg({ ok: false, text: formatErrorDetail(data) });
    setPwSubmitting(false);
  }

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch(`${API}/me/phone`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      setPhone(data.phone);
      setPhoneMsg({
        ok: true,
        text: data.phone ? t("phone_updated", { phone: data.phone }) : t("phone_removed"),
      });
    } else {
      setPhoneMsg({ ok: false, text: formatErrorDetail(data) });
    }
  }

  async function handleDeleteSearch(id: number) {
    const res = await authFetch(`${API}/me/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) setSaved((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleUnblock(username: string) {
    const res = await authFetch(`${API}/users/${encodeURIComponent(username)}/block`, { method: "DELETE" });
    if (res.ok) setBlocked((prev) => prev.filter((u) => u !== username));
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (deleting) return;
    if (!confirm(t("confirm_delete_account"))) return;
    setDeleting(true);
    const res = await authFetch(`${API}/me/delete-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: deletePw }),
    });
    if (res.ok) {
      logout();
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => null);
    setDeleteMsg({ ok: false, text: formatErrorDetail(data) });
    setDeleting(false);
  }

  // /?q=…&category=… - same URL shape the header search commits.
  function searchUrl(s: SavedSearch): string {
    const params = new URLSearchParams();
    if (s.query) params.set("q", s.query);
    if (s.category) params.set("category", s.category);
    return `/?${params.toString()}`;
  }

  return (
    <div className="container">
      <div className="settings-page">
        <h1>{t("settings_title")}</h1>

        <section className="settings-card">
          <h2>{t("sec_password")}</h2>
          <form onSubmit={handleChangePassword}>
            {pwMsg && <div className={pwMsg.ok ? "success-msg" : "error-msg"}>{pwMsg.text}</div>}
            <PasswordField
              id="current-password"
              value={currentPw}
              onChange={setCurrentPw}
              placeholder={t("ph_current_password")}
              autoComplete="current-password"
              {...pwFields}
            />
            <PasswordField
              id="new-password"
              value={newPw}
              onChange={setNewPw}
              placeholder={t("ph_new_password")}
              autoComplete="new-password"
              {...pwFields}
            />
            <PasswordField
              id="confirm-password"
              value={confirmPw}
              onChange={setConfirmPw}
              placeholder={t("ph_confirm_password")}
              autoComplete="new-password"
              {...pwFields}
            />
            <button type="submit" className="form-btn" disabled={pwSubmitting}>
              {t("btn_change_password")}
            </button>
            <p className="settings-hint">{t("pw_change_hint")}</p>
          </form>
        </section>

        <section className="settings-card">
          <h2>{t("sec_phone")}</h2>
          <p className="settings-hint">{t("phone_hint")}</p>
          <form onSubmit={handleSavePhone}>
            {phoneMsg && <div className={phoneMsg.ok ? "success-msg" : "error-msg"}>{phoneMsg.text}</div>}
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("ph_phone")}
            />
            <button type="submit" className="form-btn">
              {t("btn_save")}
            </button>
          </form>
        </section>

        <section className="settings-card">
          <h2>{t("sec_saved")}</h2>
          <p className="settings-hint">{t("saved_hint")}</p>
          {saved.length === 0 ? (
            <p className="settings-empty">{t("no_saved")}</p>
          ) : (
            <ul className="settings-list">
              {saved.map((s) => (
                <li key={s.id} className="settings-row">
                  <Link to={searchUrl(s)} className="settings-row-main">
                    {s.query && <span className="settings-row-title">“{s.query}”</span>}
                    {s.category && <span className="settings-row-sub">{catLabel(s.category, t)}</span>}
                  </Link>
                  <button type="button" className="card-action-btn" onClick={() => handleDeleteSearch(s.id)}>
                    {t("btn_delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-card">
          <h2>{t("sec_blocked")}</h2>
          {blocked.length === 0 ? (
            <p className="settings-empty">{t("no_blocked")}</p>
          ) : (
            <ul className="settings-list">
              {blocked.map((u) => (
                <li key={u} className="settings-row">
                  <span className="settings-row-main">
                    <span className="settings-row-title">{u}</span>
                  </span>
                  <button type="button" className="card-action-btn" onClick={() => handleUnblock(u)}>
                    {t("btn_unblock")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-card settings-danger">
          <h2>{t("sec_danger")}</h2>
          <p className="settings-hint">{t("danger_text")}</p>
          <form onSubmit={handleDeleteAccount}>
            {deleteMsg && <div className="error-msg">{deleteMsg.text}</div>}
            <PasswordField
              id="delete-password"
              value={deletePw}
              onChange={setDeletePw}
              placeholder={t("ph_password_confirm")}
              autoComplete="current-password"
              {...deleteField}
            />
            <button type="submit" className="form-btn" disabled={deleting || !deletePw}>
              {t("btn_delete_account")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
