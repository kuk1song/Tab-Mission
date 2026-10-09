import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tested code needs no DOM (background.js gets a small fake of the
    // chrome.* APIs in its test), so the lightweight node environment is enough.
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
  },
});
