import globals from 'globals';

// A deliberately small rule set: enough to catch the class of bug that
// motivated it (a `window` reference in the MV3 service worker, where no
// `window` global exists) plus dead code, without forcing a wider refactor.
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default [
  {
    ignores: ['node_modules/**', 'builds/**', 'extension/icons/old/**'],
  },
  {
    // Popup / overview scripts run in a normal browser document.
    files: ['extension/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules,
  },
  {
    // The MV3 service worker has no window/document — only worker globals.
    files: ['extension/background.js'],
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
];
