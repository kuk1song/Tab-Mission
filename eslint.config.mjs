import js from '@eslint/js';
import globals from 'globals';

// ESLint's recommended rules (@eslint/js): likely bugs, not style. Three
// are set apart: no-undef catches the bug that brought ESLint in (a
// `window` reference in the MV3 service worker, where no `window` global
// exists); unused arguments and caught errors may keep their names; and a
// catch may be empty (a failure that changes nothing).
const rules = {
  ...js.configs.recommended.rules,
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

// Modules the service worker imports (background.js, and covers.js imports
// utils.js): the pages import them too, but they must run without a DOM.
const WORKER_MODULES = ['extension/src/covers.js', 'extension/src/tryit.js', 'extension/src/unseen.js', 'extension/src/utils.js'];

export default [
  {
    ignores: ['node_modules/**', 'builds/**', 'local/**', 'test-results/**', 'playwright-report/**', 'screens/**'],
  },
  {
    // The Tab Mission window's, settings page's and welcome page's scripts
    // run in a normal browser document.
    files: ['extension/src/**/*.js'],
    ignores: WORKER_MODULES,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules,
  },
  {
    // The MV3 service worker and the modules it imports: no window or
    // document, only worker globals.
    files: ['extension/background.js', ...WORKER_MODULES],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
    rules,
  },
  {
    // Node-based repo tooling.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
  {
    // Playwright end-to-end tests: node code that passes callbacks to the
    // browser (page.evaluate, the extension's service worker).
    files: ['tests/e2e/**/*.mjs', 'playwright.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.webextensions },
    },
    rules,
  },
  {
    // Vitest unit tests (node env). Test helpers are imported from 'vitest'.
    files: ['tests/*.mjs', 'vitest.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
];
