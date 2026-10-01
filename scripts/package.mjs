// Build the Chrome Web Store upload: builds/tab-mission-<version>.zip, with
// manifest.json at the zip root. Run via `npm run package`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const out = resolve(`builds/tab-mission-${version}.zip`);

mkdirSync('builds', { recursive: true });
rmSync(out, { force: true });
// icons/old holds superseded artwork that the manifest never references.
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', 'icons/old/*', '*.DS_Store'], {
  cwd: 'extension',
  stdio: 'inherit',
});

console.log(`wrote ${out}`);
