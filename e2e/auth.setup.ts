import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, hasCredentials } from "./env";
import { totp } from "./totp";

// Signs in once and saves the session for the authenticated specs.
setup("sign in", async ({ page }) => {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  if (!hasCredentials) {
    // Authenticated specs skip themselves; they still need a state file to load.
    writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    setup.skip(true, "E2E_EMAIL / E2E_PASSWORD not set");
  }

  await page.goto("/login");
  await page.getByPlaceholder("email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();

  const dashboardLink = page.getByRole("link", { name: "Dashboard", exact: true });
  const codeInput = page.getByPlaceholder("123456");
  await expect(dashboardLink.or(codeInput)).toBeVisible();
  if (await codeInput.isVisible()) {
    const secret = process.env.E2E_TOTP_SECRET;
    if (!secret) throw new Error("The account has 2FA enrolled; set E2E_TOTP_SECRET");
    await codeInput.fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
  }

  await expect(dashboardLink).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
