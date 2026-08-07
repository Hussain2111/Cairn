import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'on-first-retry',
    // Every date in the app is local-time, so the tests pin a timezone to keep
    // "today" deterministic wherever they run.
    timezoneId: 'Europe/London',
    locale: 'en-GB',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Honour a pre-installed Chromium when one is provided (CI images and
        // sandboxes often ship one), otherwise use Playwright's own download.
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: 'node scripts/serve.mjs 4321',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
