/**
 * e2e tests — accessibility + visual focus (AC9)
 * axe-core: zero critical/serious violations
 * Focus ring: screenshot diff on each interactive control
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.TODO_APP_DIR
  ? path.resolve(process.env.TODO_APP_DIR)
  : path.resolve(__dirname, '../../');
const APP_URL = `file://${appDir}/index.html`;

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// AC9 — no a11y violations on initial load (critical/serious = 0)
test('AC9 a11y: no critical/serious violations on initial load', async ({ page }) => {
  // Finish any animations before axe runs
  await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );
  expect(blocking, `Violations: ${JSON.stringify(blocking.map(v => ({ id: v.id, impact: v.impact, desc: v.description })), null, 2)}`).toHaveLength(0);
});

// AC9 — no a11y violations after adding + completing a todo
test('AC9 a11y: no critical/serious violations after add + complete', async ({ page }) => {
  await page.locator('#add-title').fill('A11y test todo');
  await page.keyboard.press('Enter');

  const checkbox = page.locator('.todo-item__checkbox').first();
  await checkbox.click();

  // Wait for CSS animations to complete before running axe
  await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );
  expect(blocking, `Violations: ${JSON.stringify(blocking.map(v => ({ id: v.id, impact: v.impact, desc: v.description })), null, 2)}`).toHaveLength(0);
});

// AC9 — ARIA labels on interactive controls
test('AC9 ARIA: all interactive controls have accessible names', async ({ page }) => {
  // Add a todo so all controls are in the DOM
  await page.locator('#add-title').fill('ARIA check todo');
  await page.keyboard.press('Enter');

  // Check key controls
  await expect(page.locator('#add-btn')).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('#add-title')).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('.todo-item__checkbox').first()).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('.btn--icon[aria-label^="Edit todo"]').first()).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('.btn--icon[aria-label^="Delete todo"]').first()).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('[data-sort="date"]')).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('[data-sort="priority"]')).toHaveAttribute('aria-label', /.+/);
});

// AC9 — visible focus indicator: screenshot diff on focused add button
test('AC9 focus-ring: add button shows visible focus ring on keyboard focus', async ({ page }) => {
  await page.locator('#add-btn').focus();
  // Screenshot diff — captured as baseline on first run
  await expect(page.locator('#add-btn')).toHaveScreenshot('focus-ring-add-btn.png');
});

// AC9 — visible focus indicator: filter tab
test('AC9 focus-ring: filter tab shows visible focus ring', async ({ page }) => {
  await page.locator('[data-filter="all"]').focus();
  await expect(page.locator('[data-filter="all"]')).toHaveScreenshot('focus-ring-filter-tab.png');
});
