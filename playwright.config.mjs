import { defineConfig } from '@playwright/test';

// End-to-end tests: the unpacked extension in Playwright's bundled Chromium
// (branded Chrome no longer side-loads extensions). Each test gets a fresh
// browser profile; see tests/e2e/fixtures.mjs.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // CI: two browsers at a time on Linux (4 CPUs); one on macOS (3 CPUs, where
  // two made tests time out) and on Windows (headed, see fixtures.mjs, so
  // windows never compete for focus).
  workers: process.env.CI ? (process.platform === 'linux' ? 2 : 1) : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
