import { test, expect } from "@playwright/test";

// No session: the public surface and the auth gate.

test("health-check reports a reachable database", async ({ request }) => {
  const res = await request.get("/api/health-check");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, db: "ok" });
  // AI is optional by design: reported, never gating liveness.
  expect(["ok", "unavailable"]).toContain(body.ai);
  expect(typeof body.ai_model).toBe("string");
});

test("protected pages redirect to login without a session", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("login rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("email").fill("nobody@example.invalid");
  await page.getByPlaceholder("password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form p.text-danger")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
