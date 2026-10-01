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

// The store reads the version from manifest.json; keep package.json in step.
try {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (manifest.version !== pkg.version) {
    failed = true;
    console.error(`FAIL version mismatch: manifest ${manifest.version}, package.json ${pkg.version}`);
  } else {
    console.log(`ok   version ${manifest.version}`);
  }
} catch {
  // A parse failure was already reported above.
}

process.exit(failed ? 1 : 0);
