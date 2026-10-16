import { test, expect } from "@playwright/test";
import { hasCredentials } from "./env";

// Opt-in (E2E_ALLOW_SIGNOUT=1): /api/auth/signout calls supabase.auth.signOut(),
// whose default scope is global, so this ends the account's sessions on every
// device. Use it with a dedicated test account. Runs after the other specs.
test.skip(!hasCredentials || process.env.E2E_ALLOW_SIGNOUT !== "1", "set E2E_ALLOW_SIGNOUT=1 to run");

test("sign out ends the session", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
});
