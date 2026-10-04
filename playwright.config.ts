import { defineConfig, devices } from '@playwright/test';

// PW_CHROMIUM lets a machine reuse an already-installed Chromium build instead of downloading one.
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'zh-CN',
    timezoneId: 'America/Chicago',
    trace: 'retain-on-failure',
    launchOptions,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions } },
    {
      name: 'reduced-motion',
      use: { ...devices['Desktop Chrome'], contextOptions: { reducedMotion: 'reduce' }, launchOptions },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
