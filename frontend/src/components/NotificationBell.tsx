import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePolling } from "../lib/usePolling";
import { firstName, relativeTime } from "../lib/utils";
import { BellIcon } from "./icons";

interface Notification {
  id: number;
  type: string; // "message" | "favorite" | "saved_search"
  listing_id: number | null;
  actor: string | null;
  is_read: number;
  created_at: string;
}

const TYPE_EMOJI: Record<string, string> = {
  message: "💬",
  favorite: "❤️",
  saved_search: "🔔",
};

export default function NotificationBell() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // Opening the panel marks everything read server-side, but the items that
  // were new at that moment keep their highlight until the panel closes -
  // otherwise the things the user opened the panel to see would blend into
  // the old ones before they could be read.
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Same plain-fetch 15s poll as the unread-message badge in Nav: an expired
  // token while browsing a public page shouldn't yank the user to login -
  // the bell just goes quiet.
  useEffect(() => {
    if (!token) {
      setItems([]);
      setUnread(0);
    }
  }, [token]);

  usePolling(
    async () => {
      try {
        const res = await fetch(`${API}/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setItems(data.notifications || []);
        setUnread(data.unread || 0);
      } catch {
        // offline / backend down - badge just stays as it was
      }
    },
    15000,
    !!token,
  );

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      setFreshIds(new Set(items.filter((n) => !n.is_read).map((n) => n.id)));
      if (unread > 0) {
        // Optimistic: badge clears immediately; if the request fails the
        // next poll just brings the real count back.
        setUnread(0);
        setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
        fetch(`${API}/notifications/read-all`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }
    setOpen((v) => !v);
  }

  function go(n: Notification) {
    setOpen(false);
    if (n.type === "message" && n.listing_id && n.actor) {
      navigate(`/messages?listing_id=${n.listing_id}&to=${encodeURIComponent(n.actor)}`);
    } else if (n.listing_id) {
      navigate(`/listing/${n.listing_id}`);
    }
  }

  function label(n: Notification): string {
    const name = firstName(n.actor);
    if (n.type === "message") return t("notif_message", { name });
    if (n.type === "favorite") return t("notif_favorite", { name });
    return t("notif_saved_search");
  }

  if (!token) return null;

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        aria-label={t("notif_title")}
        title={t("notif_title")}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <BellIcon />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-head">{t("notif_title")}</div>
          {items.length === 0 ? (
            <div className="notif-empty">{t("notif_empty")}</div>
          ) : (
            <div className="notif-list">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item${freshIds.has(n.id) ? " fresh" : ""}`}
                  onClick={() => go(n)}
                >
                  <span className="notif-item-icon" aria-hidden="true">
                    {TYPE_EMOJI[n.type] || "🔔"}
                  </span>
                  <span className="notif-item-text">
                    <span className="notif-item-label">{label(n)}</span>
                    <span className="notif-item-time">{relativeTime(n.created_at, t)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
