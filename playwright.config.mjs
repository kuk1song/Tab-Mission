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
  // CI: one retry, so the report tells a test that fails every time from
  // one that fails now and then, with the traces of both runs. A test that
  // passes only on its retry still fails the run: it is a bug in the
  // product or in the test, to fix rather than retry.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure-and-retries' },
});
