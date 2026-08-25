import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { relativeTime, debounce } from "../lib/utils";
import "./Admin.css";

interface Report {
  id: number;
  listing_id: number;
  listing_title: string | null;
  listing_seller: string | null;
  reporter: string;
  reason: string;
  created_at: string;
}

interface PendingListing {
  id: number;
  title: string;
  description: string;
  price: number;
  category: string;
  seller: string;
  created_at: string;
  photos: string[];
}

interface Stats {
  window_days: number;
  counts: Record<string, number>;
  register_completion_pct: number | null;
  empty_searches: { query: string; count: number }[];
}

interface AdminUser {
  id: number;
  username: string;
  email: string;
  email_verified: boolean;
  is_admin: boolean;
  is_banned: boolean;
  listing_count: number;
  created_at: string;
}

export default function Admin() {
  const navigate = useNavigate();
  const { token, username } = useAuth();
  // Staff-only tooling, English-only: strings below are plain literals. Only
  // relativeTime() needs a real t() (it looks up the time_now/time_m/etc.
  // keys), so admins just see timestamps in whatever language they last
  // picked while browsing - a harmless side effect, not worth a second
  // English-only time formatter.
  const { t } = useTranslation();

  const [pending, setPending] = useState<PendingListing[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsDays, setStatsDays] = useState(30);

  useEffect(() => {
    if (!token) {
      navigate("/login?next=/admin");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadReports() {
    const res = await authFetch(`${API}/admin/reports`);
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    setReports(data.reports);
  }

  async function loadPending() {
    const res = await authFetch(`${API}/admin/pending`);
    if (res.status === 403) return; // the reports section shows the message
    const data = await res.json();
    setPending(data.pending);
  }

  async function handleApprove(listingId: number) {
    const res = await authFetch(`${API}/admin/listings/${listingId}/approve`, { method: "POST" });
    if (res.ok) setPending((prev) => (prev ? prev.filter((l) => l.id !== listingId) : prev));
    else alert("Approve failed");
  }

  async function handleRejectPending(listingId: number) {
    if (!confirm("Delete this listing permanently? The seller is not told why.")) return;
    const res = await authFetch(`${API}/listings/${listingId}`, { method: "DELETE" });
    if (res.ok) setPending((prev) => (prev ? prev.filter((l) => l.id !== listingId) : prev));
    else alert("Delete failed");
  }

  async function loadUsers(q: string) {
    const url = q ? `${API}/admin/users?q=${encodeURIComponent(q)}` : `${API}/admin/users`;
    const res = await authFetch(url);
    if (res.status === 403) return; // reports section already shows the admins-only message
    const data = await res.json();
    setUsers(data.users);
  }

  async function loadStats(days: number) {
    const res = await authFetch(`${API}/admin/stats?days=${days}`);
    if (res.status === 403) return; // the reports section shows the message
    setStats(await res.json());
  }

  useEffect(() => {
    loadPending();
    loadReports();
    loadUsers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadStats(statsDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsDays]);

  const [debouncedSearch] = useState(() => debounce((q: string) => loadUsers(q), 400));

  function handleSearchChange(q: string) {
    setUserQuery(q);
    debouncedSearch(q);
  }

  async function handleRemoveListing(listingId: number, reportId: number) {
    if (!confirm("Delete this listing permanently?")) return;
    const res = await authFetch(`${API}/listings/${listingId}`, { method: "DELETE" });
    if (res.ok) await handleDismiss(reportId, true);
    else alert("Delete failed");
  }

  async function handleDismiss(reportId: number, silent = false) {
    const res = await authFetch(`${API}/admin/reports/${reportId}/dismiss`, { method: "POST" });
    if (res.ok) {
      setReports((prev) => (prev ? prev.filter((r) => r.id !== reportId) : prev));
    } else if (!silent) {
      alert("Dismiss failed");
    }
  }

  async function handleToggleBan(targetUsername: string, currentlyBanned: boolean) {
    const action = currentlyBanned ? "unban" : "ban";
    if (!currentlyBanned && !confirm(`Ban "${targetUsername}"? They'll be logged out immediately and can't log back in until unbanned.`)) return;
    const res = await authFetch(`${API}/admin/users/${encodeURIComponent(targetUsername)}/${action}`, { method: "POST" });
    if (res.ok) {
      loadUsers(userQuery);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(formatErrorDetail(data, `${action} failed`));
    }
  }

  async function handleRemoveUser(targetUsername: string) {
    if (!confirm(`Permanently delete "${targetUsername}" and all their listings, photos, and messages?`)) return;
    const res = await authFetch(`${API}/admin/users/${encodeURIComponent(targetUsername)}`, { method: "DELETE" });
    if (res.ok) {
      loadUsers(userQuery);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(formatErrorDetail(data, "Delete failed"));
    }
  }

  // register_started counts everyone who asked for a code; register_verified
  // counts those who came back with it. The gap between them is the drop-off.
  const started = stats?.counts.register_started ?? 0;
  const verified = stats?.counts.register_verified ?? 0;

  return (
    <div className="admin-wrap">
      <div className="stats-head">
        <h1 style={{ fontSize: 22, margin: 0 }}>What people are doing</h1>
        <div className="stats-range">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={statsDays === d ? "sel" : ""}
              onClick={() => setStatsDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: "#777", fontSize: 14, marginBottom: 18 }}>
        Counting started on 26 July.
      </p>

      {forbidden ? null : stats === null ? null : (
        <>
          <div className="stat-row">
            <div className="stat-box">
              <div className="stat-num">{started}</div>
              <div className="stat-label">started signing up</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{verified}</div>
              <div className="stat-label">finished signing up</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">
                {stats.register_completion_pct === null ? "-" : `${stats.register_completion_pct}%`}
              </div>
              <div className="stat-label">completion rate</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{stats.counts.listing_created ?? 0}</div>
              <div className="stat-label">listings posted</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{stats.counts.message_sent ?? 0}</div>
              <div className="stat-label">messages sent</div>
            </div>
            <div className="stat-box">
              <div className="stat-num">{stats.counts.search_empty ?? 0}</div>
              <div className="stat-label">searches with no results</div>
            </div>
          </div>

          <h1 style={{ fontSize: 22, marginTop: 36 }}>Searched for and found nothing</h1>
          {stats.empty_searches.length === 0 ? (
            <p className="admin-empty" style={{ padding: "30px 0" }}>
              No empty searches yet.
            </p>
          ) : (
            <div className="empty-search-list">
              {stats.empty_searches.map((e) => (
                <div className="empty-search-row" key={e.query}>
                  <span className="q">{e.query}</span>
                  <span className="n">{e.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <h1 style={{ fontSize: 22, marginTop: 40 }}>Waiting for review</h1>

      {forbidden ? null : pending === null ? null : pending.length === 0 ? (
        <p className="admin-empty">Nothing waiting.</p>
      ) : (
        <div>
          {pending.map((l) => (
            <div className="report-card" key={l.id}>
              <h3>{l.title}</h3>
              <div className="report-meta">
                <strong>{l.seller}</strong> · {l.price === 0 ? "Free" : `${l.price} ₾`} · {l.category} · {relativeTime(l.created_at, t)}
              </div>
              {l.photos.length > 0 && (
                <div className="pending-photos">
                  {l.photos.map((src) => (
                    <img key={src} src={`${API}/${src}`} alt="" loading="lazy" />
                  ))}
                </div>
              )}
              <p className="pending-description">{l.description}</p>
              <div className="report-actions">
                <button className="approve" onClick={() => handleApprove(l.id)}>Approve</button>
                <button className="danger" onClick={() => handleRejectPending(l.id)}>Delete</button>
                <a href={`/listing/${l.id}`} target="_blank" rel="noreferrer">Open</a>
              </div>
            </div>
          ))}
        </div>
      )}

      <h1 style={{ fontSize: 22, marginTop: 36 }}>Reported listings</h1>

      {forbidden ? (
        <p className="admin-empty">This page is for admins only.</p>
      ) : reports === null ? null : reports.length === 0 ? (
        <p className="admin-empty">No open reports.</p>
      ) : (
        <div>
          {reports.map((r) => (
            <div className="report-card" key={r.id}>
              <h3>{r.listing_title ? r.listing_title : <em>Listing already deleted</em>}</h3>
              <div className="report-meta">
                Reported by <strong>{r.reporter}</strong>
                {r.listing_seller && (
                  <>
                    {" "}
                    · seller: <strong>{r.listing_seller}</strong>
                  </>
                )}{" "}
                · {relativeTime(r.created_at, t)}
              </div>
              <div className="report-reason">{r.reason}</div>
              <div className="report-actions">
                {r.listing_title && (
                  <a href={`/listing/${r.listing_id}`} target="_blank" rel="noreferrer">
                    View listing
                  </a>
                )}
                {r.listing_title && (
                  <button className="danger" onClick={() => handleRemoveListing(r.listing_id, r.id)}>
                    Delete listing
                  </button>
                )}
                <button onClick={() => handleDismiss(r.id)}>Dismiss report</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!forbidden && (
        <>
          <h1 className="admin-section-title">Users</h1>
          <input
            type="text"
            className="user-search-input"
            placeholder="Search by username or email..."
            value={userQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <div>
            {users === null ? null : users.length === 0 ? (
              <p className="admin-empty">No users match.</p>
            ) : (
              users.map((u) => (
                <div className="user-card" key={u.id}>
                  <div className="user-info">
                    <span className="username">{u.username}</span>
                    {u.is_admin && <span className="badge badge-admin">admin</span>}
                    {!u.email_verified && <span className="badge badge-unverified">unverified</span>}
                    {u.is_banned && <span className="badge badge-banned">banned</span>}
                    <div className="user-meta">
                      {u.email} · {u.listing_count} listing{u.listing_count === 1 ? "" : "s"} · joined{" "}
                      {relativeTime(u.created_at, t)}
                    </div>
                  </div>
                  {!(u.is_admin || u.username === username) && (
                    <div className="user-actions">
                      <button onClick={() => handleToggleBan(u.username, u.is_banned)}>{u.is_banned ? "Unban" : "Ban"}</button>
                      <button className="danger" onClick={() => handleRemoveUser(u.username)}>
                        Delete account
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
