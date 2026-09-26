import { expect, test } from "@playwright/test";

import {
  PASSWORD,
  publishedListing,
  registerViaApi,
  signIn,
  uniqueEmail,
  useEnglish,
} from "./helpers";

// The three journeys that have to keep working: getting an account, putting
// something up for sale, and the two people reaching each other. A backend
// test can't catch a form that stopped submitting or a button that stopped
// being wired up, which is the gap these fill.

test("a first-time visitor must accept the entry disclaimer before browsing", async ({ page }) => {
  // a fresh Playwright context starts with empty localStorage already - no
  // sign-in/lang helper here, since those also mark the disclaimer accepted
  await page.goto("/products");

  const overlay = page.locator(".entry-disclaimer-overlay");
  const continueBtn = overlay.locator("button.form-btn");
  await expect(overlay).toBeVisible();
  await expect(continueBtn).toBeDisabled();

  await overlay.locator("input[type=checkbox]").check();
  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();
  await expect(overlay).not.toBeVisible();

  // remembered: a reload doesn't ask again
  await page.reload();
  await expect(overlay).not.toBeVisible();
});

test("a student can register and post their first listing", async ({ page }) => {
  await useEnglish(page);
  const email = uniqueEmail("seller");
  const title = `Calculus textbook ${Date.now()}`;

  // scoped to the form: the header search box is also a text input
  const form = page.locator(".auth-box");
  await page.goto("/register");
  await form.locator("input[type=email]").fill(email);
  await form.locator("input[type=text]").fill("555123456");
  await form.locator("input[type=password]").nth(0).fill(PASSWORD);
  await form.locator("input[type=password]").nth(1).fill(PASSWORD);
  await form.locator("input[type=checkbox]").check();
  await form.locator("button[type=submit]").click();

  // development mode signs them straight in rather than emailing a code
  await expect.poll(() => page.evaluate(() => localStorage.getItem("token"))).not.toBeNull();

  await page.goto("/post");
  await form.locator("input[type=text]").fill(title);
  await form.locator("textarea").fill("Third edition, barely opened.");
  await form.locator("input[type=number]").fill("40");
  // the category dropdown is ours, not a native select: open it, then pick.
  // Keyed on data-cat rather than the label, which is translated.
  await form.locator(".cat-select").click();
  await form.locator('.cat-opt[data-cat="textbooks"]').click();
  await form.locator("button.form-btn").click();

  // a first listing waits for review, so it belongs to its seller and to
  // nobody else yet
  await page.goto("/mylistings");
  const card = page.locator(".listing-card", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.locator(".chip-pending")).toBeVisible();

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/products");
  await expect(page.locator(".listing-card", { hasText: title })).toHaveCount(0);
});

test("an approved listing can be found and opened by a stranger", async ({ page, request }) => {
  const seller = await registerViaApi(request, uniqueEmail("browse.seller"));
  const title = `Wilson racket ${Date.now()}`;
  const listingId = await publishedListing(request, seller.access_token, {
    title,
    price: 60,
    category: "sports",
  });

  await useEnglish(page);
  await page.goto("/products");
  await page.locator("header input[type=text], .nav-search input[type=text]").first().fill(title);
  await page.keyboard.press("Enter");

  const card = page.locator(".listing-card", { hasText: title });
  await expect(card).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/listing/${listingId}$`));
  await expect(page.getByText(title)).toBeVisible();
  // scoped to the price element - an unscoped getByText("60") can also match
  // a "60" that lands inside the title's Date.now()-based suffix by chance
  await expect(page.locator(".detail-price")).toContainText("60");
});

test("a buyer's message reaches the seller", async ({ page, request }) => {
  const seller = await registerViaApi(request, uniqueEmail("chat.seller"));
  const buyer = await registerViaApi(request, uniqueEmail("chat.buyer"));
  const title = `Mini fridge ${Date.now()}`;
  const listingId = await publishedListing(request, seller.access_token, { title, price: 120 });
  const body = `Is this still available? ${Date.now()}`;

  // buyer opens the listing and messages the seller
  await signIn(page, buyer.username, buyer.access_token);
  await page.goto(`/listing/${listingId}`);
  await page.locator("button.btn-contact").first().click();
  await expect(page).toHaveURL(/\/messages\?/);

  const composer = page.locator(".compose textarea");
  await composer.fill(body);
  await page.locator(".compose button").click();
  await expect(page.locator(".bubble", { hasText: body })).toBeVisible();

  // the seller finds it waiting for them
  await page.evaluate(() => localStorage.clear());
  await signIn(page, seller.username, seller.access_token);
  await page.goto("/messages");
  await page.locator(".convo-item").first().click();
  await expect(page.locator(".bubble", { hasText: body })).toBeVisible();
});
