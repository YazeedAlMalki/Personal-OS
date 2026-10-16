import { defineConfig, devices } from "@playwright/test";
import { AUTH_FILE } from "./e2e/env";

// Defaults to production. E2E_LOCAL=1 starts `npm run dev` and tests localhost instead.
// Signed-in specs need E2E_EMAIL + E2E_PASSWORD (and E2E_TOTP_SECRET if 2FA is on).
const local = process.env.E2E_LOCAL === "1";
const baseURL = local
  ? "http://localhost:3000"
  : process.env.BASE_URL || "https://personal-os-v2-six.vercel.app";

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Optional: use a preinstalled Chromium instead of Playwright's download.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: desktop },
    { name: "public", testMatch: /public\.spec\.ts/, use: desktop },
    {
      name: "app",
      testMatch: /smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...desktop, storageState: AUTH_FILE },
    },
    {
      name: "signout",
      testMatch: /signout\.spec\.ts/,
      dependencies: ["app"],
      use: { ...desktop, storageState: AUTH_FILE },
    },
  ],

  webServer: local
    ? { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
