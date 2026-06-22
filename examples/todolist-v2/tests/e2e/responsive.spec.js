/**
 * e2e tests — responsive layout (AC10 measured)
 * SC-005: no horizontal overflow at 320 / 768 / 1280 px
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.TODO_APP_DIR
  ? path.resolve(process.env.TODO_APP_DIR)
  : path.resolve(__dirname, '../../');
const APP_URL = `file://${appDir}/index.html`;

const VIEWPORTS = [
  { width: 320,  height: 812,  label: '320px' },
  { width: 768,  height: 1024, label: '768px' },
  { width: 1280, height: 800,  label: '1280px' },
];

for (const vp of VIEWPORTS) {
  test(`AC10 responsive ${vp.label}: no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(APP_URL);

    // Add a todo to have interactive controls visible
    await page.locator('#add-title').fill('Responsive test todo');
    await page.keyboard.press('Enter');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(vp.width);
  });

  test(`AC10 responsive ${vp.label}: all controls within viewport`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(APP_URL);
    await page.locator('#add-title').fill('Viewport control check');
    await page.keyboard.press('Enter');

    // Each interactive control must have its left/right within the viewport
    const controls = await page.locator('[id="add-title"], [id="add-btn"], .todo-item__checkbox, .btn--icon').all();
    for (const control of controls) {
      const box = await control.boundingBox();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1); // 1px tolerance
    }
  });
}
