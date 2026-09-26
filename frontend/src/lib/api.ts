// API base URL. In production the backend serves this app, so relative URLs
// work. Only the dev-server ports need an explicit backend address, built
// from the current hostname so the site also works opened from a phone on
// the same network.
import i18n from "./i18n";

const DEV_FRONTEND_PORTS = ["5173", "5500", "5501"];
export const API = DEV_FRONTEND_PORTS.includes(window.location.port)
  ? `http://${window.location.hostname}:8001`
  : "";

// ws:// or wss:// URL for the same backend API points at. The reverse proxy
// handles the websocket upgrade on the same route.
export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = API ? new URL(API).host : window.location.host;
  return `${protocol}//${host}${path}`;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  window.location.href = "/";
}

// Thrown by authFetch after it has already redirected the browser away
// (expired token or banned account); callers let it propagate.
export class AuthRedirect extends Error {}

// Wrapper for any fetch that sends the user's token. On a 401 the stale
// session is cleared and the user goes to login with a return path, instead
// of every page failing silently.
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem("token");
  options.headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url, options);

  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?expired=1&next=${next}`;
    throw new AuthRedirect("session expired");
  }

  // A ban applies mid-session (checked per request server-side). Clone
  // before reading: other 403s must reach the caller intact.
  if (res.status === 403) {
    let detail: string | null = null;
    try {
      detail = (await res.clone().json()).detail;
    } catch {
      detail = null;
    }
    if (detail === "account_banned") {
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      window.location.href = "/login?banned=1";
      throw new AuthRedirect("account banned");
    }
  }

  return res;
}

// Backend error payload -> readable, translated message.
//
// The backend sends stable error codes rather than English sentences:
//   - static errors:  detail is a snake_case code ("invalid_credentials")
//   - dynamic errors: detail is { code, ...params }, e.g.
//                     { code: "file_too_large", max_mb: 8 }
// Each code maps to an "err_<code>" key in en.json / ka.json. Unknown bare
// codes fall back to a generic message; a real sentence is shown as-is.
// FastAPI validation errors arrive as an array of field objects.
export function formatErrorDetail(data: any, fallback?: string): string {
  // t() is typed string | object (returnObjects); error keys are always
  // plain strings
  const t = (key: string, opts?: Record<string, unknown>): string =>
    i18n.t(key, opts) as string;
  const d = data?.detail;

  if (d && typeof d === "object" && !Array.isArray(d) && typeof d.code === "string") {
    const msg = t(`err_${d.code}`, { ...d, defaultValue: "" });
    return msg || fallback || t("err_generic");
  }

  if (typeof d === "string") {
    const msg = t(`err_${d}`, { defaultValue: "" });
    if (msg) return msg;
    return /^[a-z0-9_]+$/.test(d) ? fallback || t("err_generic") : d;
  }

  if (Array.isArray(d)) return fallback || t("err_check_input");
  return fallback || t("err_generic");
}
