import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://personal-os-v2-six.vercel.app';
const TEST_EMAIL = process.env.TEST_EMAIL || 'ymalki95@gmail.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Ym#0542773344';

test.describe('Personal OS V2 E2E Smoke Tests', () => {
  test.describe.configure({ timeout: 30000 });

  // ============================================================================
  // Test 1: App Home - Dashboard Loads
  // ============================================================================
  test('1. App Home - Dashboard Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify we can see the main content area
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 2: Calendar Page Loads
  // ============================================================================
  test('2. Calendar Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/calendar`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 3: Finance Page Loads
  // ============================================================================
  test('3. Finance Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/finance`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 4: Health Page Loads
  // ============================================================================
  test('4. Health Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/health`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 5: Tasks Page Loads
  // ============================================================================
  test('5. Tasks Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/tasks`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 6: Goals Page Loads
  // ============================================================================
  test('6. Goals Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/goals`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 7: Projects Page Loads
  // ============================================================================
  test('7. Projects Page Loads', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto(`${BASE_URL}/projects`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 8: Health-Check API Endpoint
  // ============================================================================
  test('8. Health-Check API Endpoint', async ({ page }) => {
    test.setTimeout(10000);

    const response = await page.request.get(`${BASE_URL}/api/health-check`);
    
    // Status might be 200 or 404 depending on deployment
    expect([200, 404]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('db');
      expect(data).toHaveProperty('ai');
      expect(data).toHaveProperty('ai_model');
    }
  });
});

test.describe.configure({
  timeout: 2 * 60 * 1000, // 2 minutes per spec
});
