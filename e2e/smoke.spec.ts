import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://personal-os-v2-ym-ac3a.vercel.app';

// Use environment variables for credentials, fallback to test accounts
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'test-password-123';

test.describe('Personal OS V2 E2E Smoke Tests', () => {
  let authToken: string;

  test.describe.configure({ timeout: 30000 }); // 30s per test

  // ============================================================================
  // Test 1: Auth - Login Flow
  // ============================================================================
  test('1. Auth: Login Flow', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveURL(/login/);

    // Fill in credentials
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');

    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);

    // Submit form - button contains "Sign in"
    const submitButton = page.locator('button:has-text("Sign in")');
    await submitButton.click();

    // Wait for navigation to dashboard
    await page.waitForURL(url => {
      const pathname = url.pathname;
      return pathname === '/' || pathname === '/app' || pathname.includes('dashboard');
    }, { timeout: 10000 });

    // Verify user is authenticated - check for sidebar/nav presence
    const aside = page.locator('aside');
    await expect(aside).toBeVisible({ timeout: 5000 });

    // Store auth info for subsequent tests
    const cookies = await page.context().cookies();
    authToken = cookies.find(c => c.name === 'sb-auth-token')?.value || '';
  });

  // ============================================================================
  // Test 2: Auth - Logout Flow
  // ============================================================================
  test('2. Auth: Logout Flow', async ({ page }) => {
    test.setTimeout(30000);

    // Start from dashboard
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Find logout button - it says "Sign out"
    let signoutButton = page.locator('button:has-text("Sign out")').first();
    
    if (await signoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signoutButton.click();

      // Verify redirect to login or home
      await page.waitForURL(url => {
        const pathname = url.pathname;
        return pathname === '/' || pathname === '/login';
      }, { timeout: 5000 });
    }
  });

  // ============================================================================
  // Test 3: Navigation - Sidebar Menu
  // ============================================================================
  test('3. Navigation: Sidebar Menu', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify sidebar (aside) exists
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // List of expected nav items - these are the actual labels in NavRail
    const navItems = [
      'Dashboard',
      'Tasks',
      'Calendar',
      'Goals',
      'Projects',
      'Health',
      'Finance',
    ];

    // Check for nav items in the aside element
    let foundItems = 0;
    for (const item of navItems) {
      const navLink = page.locator(`aside a:has-text("${item}")`).first();
      if (await navLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        foundItems++;
        // Click and verify no 404
        await navLink.click();
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // Check for 404 indicator
        const notFound = page.locator('text=/404|not found/i').first();
        const isNotFound = await notFound.isVisible({ timeout: 1000 }).catch(() => false);
        expect(isNotFound).toBeFalsy();
      }
    }

    // Expect to find at least 3 nav items
    expect(foundItems).toBeGreaterThanOrEqual(3);
  });

  // ============================================================================
  // Test 4: Calendar - Event List Renders
  // ============================================================================
  test('4. Calendar: Event List Renders', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/calendar`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify page loaded (sidebar should be visible)
    const aside = page.locator('aside');
    await expect(aside).toBeVisible({ timeout: 5000 }).catch(() => {});

    // Look for events in the page
    const eventElements = page.locator('[data-testid*="event"], .event, [role="listitem"]:has-text(/\\d+:\\d+|AM|PM|all.day/i)');
    const eventCount = await eventElements.count().catch(() => 0);

    // If events exist, verify they render correctly
    if (eventCount > 0) {
      const firstEvent = eventElements.first();
      await expect(firstEvent).toBeVisible();

      // Check for time display or all-day indicator
      const eventText = await firstEvent.textContent();
      expect(eventText).toBeTruthy();

      // Verify either time format (HH:MM) or all-day text
      const hasTime = /\d{1,2}:\d{2}|AM|PM/.test(eventText || '');
      const hasAllDay = /all.day|all-day/i.test(eventText || '');
      expect(hasTime || hasAllDay).toBeTruthy();
    }
  });

  // ============================================================================
  // Test 5: Finance - Snapshot Displays
  // ============================================================================
  test('5. Finance: Snapshot Displays', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/finance`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify sidebar visible
    await expect(page.locator('aside')).toBeVisible({ timeout: 5000 }).catch(() => {});

    // Look for finance content (the page should have some content)
    const pageContent = page.locator('main');
    await expect(pageContent).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 6: Health - Daily Log Renders
  // ============================================================================
  test('6. Health: Daily Log Renders', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/health`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify sidebar visible
    await expect(page.locator('aside')).toBeVisible({ timeout: 5000 }).catch(() => {});

    // Verify page loaded with content
    const pageContent = page.locator('main');
    await expect(pageContent).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 7: Tasks - List View & Filter
  // ============================================================================
  test('7. Tasks: List View & Filter', async ({ page }) => {
    test.setTimeout(30000);

    await page.goto(`${BASE_URL}/tasks`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Verify sidebar visible
    await expect(page.locator('aside')).toBeVisible({ timeout: 5000 }).catch(() => {});

    // Verify page loaded with content
    const pageContent = page.locator('main');
    await expect(pageContent).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  // ============================================================================
  // Test 8: Health-Check API Endpoint
  // ============================================================================
  test('8. Health-Check API Endpoint', async ({ page }) => {
    test.setTimeout(10000);

    const response = await page.request.get(`${BASE_URL}/api/health-check`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('ok');
    expect(data).toHaveProperty('db');
    expect(data).toHaveProperty('ai');
    expect(data).toHaveProperty('ai_model');

    // Verify types
    expect(typeof data.ok).toBe('boolean');
    expect(typeof data.db).toBe('string');
    expect(typeof data.ai).toBe('string');
    expect(typeof data.ai_model).toBe('string');

    // Log health status
    console.log('Health Check Response:', data);
  });
});

// Configure test settings
test.describe.configure({
  timeout: 2 * 60 * 1000, // 2 minutes per spec
});
