import type { TFunction } from "i18next";

// Debounced version of `fn` that only runs after `delay` ms have passed
// without it being called again. Use for live-search inputs.
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Usernames are "Firstname Lastname"; cards show just the first name
// (.card-seller's CSS truncation covers long ones), the detail page shows
// the full name.
export function firstName(fullName?: string | null): string {
  return (fullName || "").split(" ")[0];
}

export function truncate(str?: string | null, maxLen = 90): string {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen).trimEnd() + "…" : str;
}

export function relativeTime(isoString: string | null | undefined, t: TFunction): string {
  if (!isoString) return "";
  // Backend sends naive UTC without a "Z" suffix - append one so the
  // browser parses it as UTC instead of local time.
  const then = new Date(isoString + (isoString.endsWith("Z") ? "" : "Z"));
  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("time_now");
  if (diffMin < 60) return t("time_m", { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("time_h", { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return t("time_d", { n: diffDay });
  const diffMonth = Math.floor(diffDay / 30);
  return t("time_mo", { n: diffMonth });
}

// The category values the backend accepts - shared by the header search,
// the homepage tiles, the post form, and the category quick-links. Must
// stay in sync with ALLOWED_CATEGORIES in backend/main.py.
export const CATEGORIES = [
  "textbooks",
  "notes",
  "electronics",
  "clothes",
  "dorm",
  "bikes",
  "sports",
  "tickets",
  "services",
  "other",
];

// Translated label for a category value ("textbooks" -> "სახელმძღვანელოები" / "Textbooks").
export function catLabel(category: string, t: TFunction): string {
  return t("cat_" + category);
}

// "1 view" / "12 ნახვა" - used on My Listings cards and the owner's detail view.
export function viewsLabel(n: number | null | undefined, t: TFunction): string {
  const count = n || 0;
  return count === 1 ? t("views_one") : t("views_other", { n: count });
}

// uploads/123_abc.jpg -> uploads/thumbs/123_abc.jpg
export function thumbUrl(path: string): string {
  return path.replace(/^uploads\//, "uploads/thumbs/");
}

// uploads/123_abc.jpg -> uploads/123_abc.webp - the backend saves a WebP
// sibling of every JPEG it produces (same base name), so this is a pure
// string transform, no extra API field needed.
export function webpUrl(path: string): string {
  return path.replace(/\.[^.]+$/, ".webp");
}

export interface Listing {
  id: number;
  title: string;
  description: string;
  price: number;
  category: string;
  status: string;
  seller: string;
  seller_id: number;
  photo_url: string | null;
  photos?: string[];
  views: number;
  is_favorited: boolean;
  created_at: string;
}

// Normalizes a listing into a plain array of photo paths, whatever the
// backend sent us.
export function listingPhotos(listing: Listing): string[] {
  if (Array.isArray(listing.photos) && listing.photos.length) return listing.photos;
  if (listing.photo_url) return [listing.photo_url];
  return [];
}

// Support address shown on the contact and legal pages.
export const CONTACT_EMAIL = "otosepashvili314@gmail.com";
