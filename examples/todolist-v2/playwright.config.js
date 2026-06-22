import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve app directory: env override or this package's directory
const appDir = process.env.TODO_APP_DIR
  ? path.resolve(process.env.TODO_APP_DIR)
  : __dirname;

// Detect system Chrome; fall back to bundled Chromium
const chromeApp = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const useSystemChrome = fs.existsSync(chromeApp);

export default defineConfig({
  testDir: './tests/e2e',
  snapshotDir: './tests/snapshots',
  use: {
    baseURL: `file://${appDir}/index.html`,
    // system Chrome preferred; bundled Chromium fallback
    ...(useSystemChrome
      ? { channel: 'chrome' }
      : {}),
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' } : {}),
      },
    },
  ],
  // Store snapshots alongside test files
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 50,
    },
  },
});
