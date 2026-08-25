import type { APIRequestContext, Page } from "@playwright/test";

// Setup goes through the API; the tests only drive the UI for the thing they
// are actually about. Selectors below use input types rather than placeholder
// text, so a wording change in either language doesn't break the suite.

export const PASSWORD = "e2epassword1";

/** Unique per run, so repeated runs against the same file don't collide. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;
}

export async function registerViaApi(request: APIRequestContext, email: string) {
  const res = await request.post("/register", {
    data: { email, phone: "", password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; username: string }>;
}

/** The admin account the config names in MARKETPLACE_ADMINS. */
export async function adminToken(request: APIRequestContext): Promise<string> {
  const email = "qa.admin@example.com";
  const res = await request.post("/register", {
    data: { email, phone: "", password: PASSWORD },
  });
  if (res.ok()) return (await res.json()).access_token;
  // already exists from an earlier run
  const login = await request.post("/login", { data: { username: email, password: PASSWORD } });
  if (!login.ok()) throw new Error(`admin login failed: ${await login.text()}`);
  return (await login.json()).access_token;
}

/** A listing students can actually see: created, then approved as an admin. */
export async function publishedListing(
  request: APIRequestContext,
  sellerToken: string,
  fields: { title: string; description?: string; price?: number; category?: string },
): Promise<number> {
  const res = await request.post("/listings", {
    headers: { Authorization: `Bearer ${sellerToken}` },
    data: {
      title: fields.title,
      description: fields.description ?? "Posted by the end-to-end tests.",
      price: fields.price ?? 25,
      category: fields.category ?? "textbooks",
      client_token: `e2e-${Date.now()}-${Math.random()}`,
    },
  });
  if (!res.ok()) throw new Error(`create listing failed: ${await res.text()}`);
  const { listing_id, pending_review } = await res.json();

  if (pending_review) {
    const token = await adminToken(request);
    const approve = await request.post(`/admin/listings/${listing_id}/approve`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!approve.ok()) throw new Error(`approve failed: ${await approve.text()}`);
  }
  return listing_id;
}

/** Sign the browser in without going through the form, and pin the language
 *  so assertions don't depend on which one the UI defaults to. */
export async function signIn(page: Page, username: string, token: string) {
  await page.addInitScript(
    ([u, t]) => {
      localStorage.setItem("username", u);
      localStorage.setItem("token", t);
      localStorage.setItem("lang", "en");
      localStorage.setItem("btu_disclaimer_ack", "1");
    },
    [username, token],
  );
}

export async function useEnglish(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("btu_disclaimer_ack", "1");
  });
}
