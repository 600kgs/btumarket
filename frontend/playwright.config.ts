import { defineConfig, devices } from "@playwright/test";

// The tests drive the real backend serving the real built frontend, the same
// arrangement production runs: one origin, no dev server. That means a build
// has to exist first - `npm run test:e2e` does it, CI does it as its own step.
//
// The backend runs in development mode against a throwaway SQLite file, so
// nothing here needs Postgres, Redis or a mail server: email verification is
// off, and every Redis-backed check already fails open when Redis is absent.
const PORT = 8002;
const python = process.platform === "win32" ? "py" : "python";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one shared database
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `${python} -m uvicorn main:app --port ${PORT}`,
    cwd: "../backend",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      MARKETPLACE_DEV: "1",
      MARKETPLACE_REQUIRE_EMAIL_VERIFICATION: "0",
      MARKETPLACE_ALLOWED_EMAIL_DOMAINS: "",
      MARKETPLACE_DATABASE_URL: "sqlite:///./e2e.db",
      MARKETPLACE_FRONTEND_DIR: "../frontend/dist",
      // the account the tests approve listings with
      MARKETPLACE_ADMINS: "qa admin",
      PYTHONIOENCODING: "utf-8",
    },
  },
});
