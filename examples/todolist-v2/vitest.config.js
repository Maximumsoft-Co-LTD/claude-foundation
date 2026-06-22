import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Only include unit + integration tests; exclude e2e (those are Playwright)
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    // happy-dom provides localStorage natively without URL config
    environmentOptions: {
      happyDOM: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./tests/setup-env.js'],
    coverage: {
      provider: 'v8',
      include: ['app.js'],
      reporter: ['text', 'json-summary'],
    },
  },
});
