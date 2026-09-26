import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { API, authFetch, formatErrorDetail } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { CATEGORIES } from "../lib/utils";

const MAX_PHOTOS = 12;

interface PhotoItem {
  id: number;
  path: string;
}

export default function Post() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, username } = useAuth();
  const [params] = useSearchParams();
  const editId = params.get("edit");

  usePageTitle(editId ? "page_title_listing" : "page_title_post");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [existingPhotos, setExistingPhotos] = useState<PhotoItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catRef = useRef<HTMLDivElement>(null);

  // Generated once per page load, sent with every create/update attempt from
  // this form - lets the server recognize repeat submissions as retries
  // rather than new listings (see backend/main.py's create_listing).
  const [clientToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!token) {
      navigate("/login?reason=login_required&next=/post");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const res = await authFetch(`${API}/listings/${editId}`);
      if (!res.ok) {
        navigate("/");
        return;
      }
      const l = await res.json();
      // Only the owner belongs here; the server enforces this on save too.
      if (l.seller !== username) {
        navigate(`/listing/${editId}`);
        return;
      }
      setTitle(l.title);
      setDescription(l.description);
      setPrice(String(l.price));
      setCategory(l.category);
      setExistingPhotos(l.photo_items || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, username]);

  async function handleRemovePhoto(photoId: number) {
    if (!confirm(t("confirm_remove_photo"))) return;
    const res = await authFetch(`${API}/listings/${editId}/photos/${photoId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(formatErrorDetail(data));
      return;
    }
    // Re-fetch to redraw the strip with fresh data.
    const listing = await (await authFetch(`${API}/listings/${editId}`)).json();
    setExistingPhotos(listing.photo_items || []);
  }

  async function handleSubmit() {
    if (submitting) return; // guard against double-clicks / button-mashing

    if (!title || !description || !price || !category) {
      setError(t("error_fill_fields"));
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0 || priceNum > 100000) {
      setError(t("error_price_range"));
      return;
    }

    // In edit mode the cap counts photos the listing already has.
    if (existingPhotos.length + files.length > MAX_PHOTOS) {
      setError(t("error_max_photos", { max: MAX_PHOTOS - existingPhotos.length }));
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await authFetch(editId ? `${API}/listings/${editId}` : `${API}/listings`, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, price: priceNum, category, client_token: clientToken }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(formatErrorDetail(data, t("register_failed_default")));
      setSubmitting(false);
      return;
    }

    const listingId = editId || data.listing_id;
    // A first listing waits for an admin, and isn't on the homepage yet -
    // landing there would look like it had vanished. Send the seller to My
    // Listings, where it is visible with its "in review" badge.
    const pendingReview = !editId && data.pending_review;
    const donePage = editId ? `/listing/${editId}` : pendingReview ? "/mylistings" : "/";

    if (files.length && listingId) {
      let failedUploads = 0;

      // Uploaded one at a time (rather than all at once) to keep this simple
      // and match the single-file backend endpoint.
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const photoRes = await authFetch(`${API}/listings/${listingId}/photos`, { method: "POST", body: formData });
        if (!photoRes.ok) failedUploads++;
      }

      if (failedUploads > 0) {
        setSuccess(null);
        setError(t("success_partial_fail", { n: failedUploads }));
        setTimeout(() => navigate(donePage), 2500);
        return;
      }
    }

    setSuccess(
      editId ? t("success_updated") : pendingReview ? t("success_posted_pending") : t("success_posted"),
    );
    // longer for the pending message: it is a sentence to read, not a tick
    setTimeout(() => navigate(donePage), pendingReview ? 3200 : 1200);
  }

  // Close the category list on an outside click or Escape, the same way the
  // header's does - a custom dropdown has to do this itself.
  useEffect(() => {
    if (!catOpen) return;
    function onClick(e: MouseEvent) {
      if (catRef.current && !catRef.current.contains(e.target as Node)) {
        setCatOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCatOpen(false);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [catOpen]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box" style={{ maxWidth: 550 }}>
        <h2>{t(editId ? "edit_title" : "post_title")}</h2>
        <p className="auth-subtitle">{t(editId ? "edit_subtitle" : "post_subtitle")}</p>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <input
          type="text"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("ph_title")}
        />
        <textarea
          maxLength={5000}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t("ph_description")}
          style={{ width: "100%", padding: "12px 15px", marginBottom: 15, border: "1px solid #ddd", borderRadius: 8, fontSize: 14, resize: "vertical" }}
        />
        <input
          type="number"
          min={0}
          max={100000}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("ph_price")}
        />
        {/* The same dropdown the header uses, rather than a native select. A
            native select's list is drawn by the browser, which reports neither
            when it opens nor when it closes - so a caret animated off focus
            stayed turned after the list had shut. Owning the open state is the
            only way the arrow can tell the truth. */}
        <div className="select-wrap" ref={catRef}>
          <button
            type="button"
            className={`cat-select${catOpen ? " open" : ""}${category ? "" : " placeholder"}`}
            aria-haspopup="listbox"
            aria-expanded={catOpen}
            onClick={() => setCatOpen((v) => !v)}
          >
            <span>{category ? t("cat_" + category) : t("opt_select_category")}</span>
            <span className="nav-caret" aria-hidden="true">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </button>
          {catOpen && (
            <div className="cat-menu" role="listbox">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="option"
                  data-cat={cat}
                  aria-selected={category === cat}
                  className={`cat-opt${category === cat ? " sel" : ""}`}
                  onClick={() => {
                    setCategory(cat);
                    setCatOpen(false);
                  }}
                >
                  {t("cat_" + cat)}
                </button>
              ))}
            </div>
          )}
        </div>

        {existingPhotos.length > 0 && (
          <>
            <div style={{ display: "block", fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#a3a3ab", marginBottom: 8 }}>
              {t("current_photos")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {existingPhotos.map((p) => (
                <span key={p.id} className="photo-thumb">
                  <img src={`${API}/${p.path}`} alt="" />
                  <button type="button" className="photo-thumb-remove" aria-label="Remove photo" onClick={() => handleRemovePhoto(p.id)}>
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ marginBottom: 6 }}
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <p style={{ color: "#8a8a93", fontSize: 12.5, marginBottom: 15 }}>{t("photo_hint", { max: MAX_PHOTOS })}</p>

        <button className="form-btn" disabled={submitting} onClick={handleSubmit}>
          {t(editId ? "btn_save" : "btn_post")}
        </button>
      </div>
    </div>
  );
}
