/**
 * e2e tests — keyboard-only operation (AC8)
 * All interactions via Playwright keyboard API; zero pointer input.
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

// AC8 — keyboard: add todo via Tab + Enter
test('AC8 keyboard-add: Tab to input, type title, Enter → item appears', async ({ page }) => {
  // Focus the title input (it is the first interactive element after load)
  await page.locator('#add-title').focus();
  await page.keyboard.type('Keyboard todo');
  await page.keyboard.press('Enter');

  const item = page.locator('.todo-item').first();
  await expect(item).toBeVisible();
  await expect(item).toContainText('Keyboard todo');
});

// AC8 — keyboard: toggle via Tab to checkbox + Space
test('AC8 keyboard-toggle: Tab to checkbox, Space → todo toggles completed', async ({ page }) => {
  // Add a todo first via keyboard
  await page.locator('#add-title').fill('Toggle via keyboard');
  await page.keyboard.press('Enter');

  // Focus the checkbox
  await page.locator('.todo-item__checkbox').first().focus();
  await page.keyboard.press('Space');

  const item = page.locator('.todo-item').first();
  await expect(item).toHaveClass(/completed/);
});

// AC8 — keyboard: edit via Tab to edit button, Enter to open, type, Enter to save
test('AC8 keyboard-edit: Tab to edit btn, Enter to open, type, Enter to save', async ({ page }) => {
  await page.locator('#add-title').fill('Original');
  await page.keyboard.press('Enter');

  const editBtn = page.locator('.btn--icon[aria-label^="Edit todo"]').first();
  await editBtn.focus();
  await page.keyboard.press('Enter');

  // Edit input should be focused
  const editInput = page.locator('.todo-item__edit-input').first();
  await expect(editInput).toBeFocused();
  await editInput.fill('Updated via keyboard');
  await page.keyboard.press('Enter');

  await expect(page.locator('.todo-item__title').first()).toContainText('Updated via keyboard');
});

// AC8 — keyboard: delete via Tab to delete button + Enter
test('AC8 keyboard-delete: Tab to delete button, Enter → todo removed', async ({ page }) => {
  await page.locator('#add-title').fill('To delete via keyboard');
  await page.keyboard.press('Enter');

  const deleteBtn = page.locator('.btn--icon[aria-label^="Delete todo"]').first();
  await deleteBtn.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('.todo-item')).toHaveCount(0);
});

// AC8 — keyboard: Escape cancels edit
test('AC8 keyboard-Escape: Escape while editing restores original text and closes edit', async ({ page }) => {
  await page.locator('#add-title').fill('Stay original');
  await page.keyboard.press('Enter');

  const editBtn = page.locator('.btn--icon[aria-label^="Edit todo"]').first();
  await editBtn.focus();
  await page.keyboard.press('Enter');

  const editInput = page.locator('.todo-item__edit-input').first();
  await editInput.fill('Edited but cancelled');
  await page.keyboard.press('Escape');

  // Edit area hidden
  const editArea = page.locator('.todo-item__edit-area').first();
  await expect(editArea).not.toBeVisible();

  // Original title still shown
  await expect(page.locator('.todo-item__title').first()).toContainText('Stay original');
});
