/**
 * e2e tests — sort controls (AC18 e2e, AC19 e2e)
 * Clicking data-sort="date" / data-sort="priority" reorders visible list.
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

async function addTodo(page, title, { dueDate = '', priority = '' } = {}) {
  await page.locator('#add-title').fill(title);
  if (dueDate)   await page.locator('#add-due-date').fill(dueDate);
  if (priority)  await page.locator('#add-priority').selectOption(priority);
  await page.keyboard.press('Enter');
}

// AC18 e2e: sort by due date ascending
test('AC18 e2e: clicking sort-by-date reorders list earliest-first, undated last', async ({ page }) => {
  await addTodo(page, 'Late task',     { dueDate: '2025-12-31' });
  await addTodo(page, 'Early task',    { dueDate: '2025-01-15' });
  await addTodo(page, 'Undated task');

  // Click the date sort button
  await page.locator('[data-sort="date"]').click();

  const titles = await page.locator('.todo-item__title').allTextContents();
  expect(titles[0]).toContain('Early task');
  expect(titles[1]).toContain('Late task');
  expect(titles[2]).toContain('Undated task');
});

// AC19 e2e: sort by priority descending
test('AC19 e2e: clicking sort-by-priority reorders list High→Medium→Low→none', async ({ page }) => {
  await addTodo(page, 'Low task',    { priority: 'Low'    });
  await addTodo(page, 'High task',   { priority: 'High'   });
  await addTodo(page, 'No priority task');
  await addTodo(page, 'Medium task', { priority: 'Medium' });

  await page.locator('[data-sort="priority"]').click();

  const titles = await page.locator('.todo-item__title').allTextContents();
  expect(titles[0]).toContain('High task');
  expect(titles[1]).toContain('Medium task');
  expect(titles[2]).toContain('Low task');
  expect(titles[3]).toContain('No priority task');
});
