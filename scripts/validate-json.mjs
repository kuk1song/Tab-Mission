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

// Permissions decide what users are asked to accept and what store review
// looks at, so a change must be deliberate: update this list along with the
// manifest (and PRIVACY.md).
const EXPECTED_PERMISSIONS = {
  permissions: ['scripting', 'storage', 'system.display', 'tabs'],
  host_permissions: ['<all_urls>'],
  optional_permissions: [],
  optional_host_permissions: [],
};
try {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  for (const [key, expected] of Object.entries(EXPECTED_PERMISSIONS)) {
    const actual = [...(manifest[key] || [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
      failed = true;
      console.error(`FAIL ${key}: manifest has ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (!failed) console.log('ok   permissions unchanged');
} catch {
  // A parse failure was already reported above.
}

// The store rejects a name over 75 characters or a description over 132, in
// any language.
const STORE_LIMITS = { name: 75, description: 132 };
try {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  let tooLong = false;
  for (const file of files.filter((f) => f.includes('_locales'))) {
    const messages = JSON.parse(readFileSync(file, 'utf8'));
    for (const [field, max] of Object.entries(STORE_LIMITS)) {
      const key = /^__MSG_(\w+)__$/.exec(manifest[field])?.[1];
      const length = [...((key ? messages[key]?.message : manifest[field]) ?? '')].length;
      if (length > max) {
        tooLong = true;
        console.error(`FAIL ${file}: ${field} has ${length} characters, the store allows ${max}`);
      }
    }
  }
  if (tooLong) failed = true;
  else console.log('ok   name and description lengths');
} catch {
  // A parse failure was already reported above.
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
