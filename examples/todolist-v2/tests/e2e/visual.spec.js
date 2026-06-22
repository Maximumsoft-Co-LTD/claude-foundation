/**
 * e2e tests — visual regression baselines + journey screenshots
 * Visual + a11y plan rows: empty-state, mixed-list, filter-completed
 */
import { test, expect } from '@playwright/test';
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

// Visual baseline: empty state
test('visual baseline: empty state matches snapshot', async ({ page }) => {
  await expect(page).toHaveScreenshot('empty-state.png', { fullPage: true });
});

// Visual baseline: populated list (mixed active/completed)
test('visual baseline: mixed-list matches snapshot', async ({ page }) => {
  await page.locator('#add-title').fill('Active task 1');
  await page.keyboard.press('Enter');
  await page.locator('#add-title').fill('Active task 2');
  await page.keyboard.press('Enter');
  await page.locator('#add-title').fill('Completed task');
  await page.keyboard.press('Enter');

  // Complete the third
  const checkboxes = await page.locator('.todo-item__checkbox').all();
  await checkboxes[2].click();

  await expect(page).toHaveScreenshot('mixed-list.png', { fullPage: true });
});

// AC12 visual: filter-completed state
test('visual baseline: Completed filter matches snapshot (AC12)', async ({ page }) => {
  await page.locator('#add-title').fill('Active');
  await page.keyboard.press('Enter');
  await page.locator('#add-title').fill('Done 1');
  await page.keyboard.press('Enter');
  await page.locator('#add-title').fill('Done 2');
  await page.keyboard.press('Enter');

  // Complete last two
  const checkboxes = await page.locator('.todo-item__checkbox').all();
  await checkboxes[1].click();
  // Re-query after re-render
  const checkboxes2 = await page.locator('.todo-item__checkbox').all();
  await checkboxes2[2].click();

  // Apply Completed filter
  await page.locator('[data-filter="completed"]').click();

  await expect(page).toHaveScreenshot('filter-completed.png', { fullPage: true });
});
