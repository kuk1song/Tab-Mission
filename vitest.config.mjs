import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tested code (applyFilters, pure utils) needs neither a DOM nor the
    // chrome.* APIs, so the lightweight node environment is enough.
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
  },
});
