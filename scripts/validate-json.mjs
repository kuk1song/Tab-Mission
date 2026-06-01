// Validate that the extension's hand-edited JSON files parse cleanly.
// Run via `npm run validate:json` and in CI.
import { readFileSync } from 'node:fs';

const files = [
  'extension/manifest.json',
  'extension/_locales/en/messages.json',
  'extension/_locales/it/messages.json',
  'extension/_locales/zh_CN/messages.json',
];

let failed = false;
for (const file of files) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    console.log(`ok   ${file}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${file}: ${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
