import { test as base, expect, type Page } from "@playwright/test";
import { hasCredentials } from "./env";

// Signed-in smoke tests (session from auth.setup.ts). Read-only: nothing here
// writes data, so they are safe to run against production.

// Fail any test whose page throws an uncaught error.
const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "uncaught page errors").toEqual([]);
  },
});

test.skip(!hasCredentials, "E2E_EMAIL / E2E_PASSWORD not set");

const NAV: [label: string, path: string, heading: string][] = [
  ["Dashboard", "/", "Today"],
  ["Tasks", "/tasks", "Tasks"],
  ["Calendar", "/calendar", "Calendar"],
  ["Goals", "/goals", "Goals"],
  ["Projects", "/projects", "Projects"],
  ["Health", "/health", "Health & fitness"],
  ["Journal", "/journal", "Journal"],
  ["CRM", "/crm", "CRM"],
  ["Opportunities", "/opportunities", "Opportunities"],
  ["Decisions", "/decisions", "Decision Journal"],
  ["Risks", "/risks", "Risk Register"],
  ["Finance", "/finance", "Finance"],
  ["Learning", "/learning", "Learning"],
  ["Graph", "/graph", "Relationship Graph"],
  ["Insights", "/insights", "Insights"],
  ["Settings", "/settings", "Settings"],
];

// A page that failed to load data renders a "Could not load …" panel instead of its h1.
async function expectPageLoaded(page: Page, heading: string) {
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  await expect(page.getByText(/could not load/i)).toHaveCount(0);
}

test("sidebar reaches every section and marks it active", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator("aside nav");
  for (const [label, path, heading] of NAV) {
    const link = nav.getByRole("link", { name: label, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
    await expectPageLoaded(page, heading);
    await expect(link).toHaveClass(/(^|\s)bg-ink-2(\s|$)/);
  }
});

test("calendar lists events without a load error", async ({ page }) => {
  const res = await page.goto("/calendar");
  expect(res?.status()).toBeLessThan(400);
  await expectPageLoaded(page, "Calendar");
  // "Add event" always renders; "Upcoming" only when there are no events.
  await expect(page.getByText("Add event", { exact: true })).toBeVisible();
});

test("finance shows net worth and the snapshot list", async ({ page }) => {
  const res = await page.goto("/finance");
  expect(res?.status()).toBeLessThan(400);
  await expectPageLoaded(page, "Finance");
  await expect(page.getByText(/^Net worth:/)).toBeVisible();
  await expect(page.getByText(/^Snapshots \(\d+\)$/)).toBeVisible();
});

test("health shows today's log form", async ({ page }) => {
  const res = await page.goto("/health");
  expect(res?.status()).toBeLessThan(400);
  await expectPageLoaded(page, "Health & fitness");
  await expect(page.getByText("Log today", { exact: true })).toBeVisible();
});

test("tasks shows the task list", async ({ page }) => {
  const res = await page.goto("/tasks");
  expect(res?.status()).toBeLessThan(400);
  await expectPageLoaded(page, "Tasks");
  await expect(page.getByText(/^All tasks \(\d+\)$/)).toBeVisible();
});
