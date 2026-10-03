// Build the Chrome Web Store upload: builds/tab-mission-<version>.zip, with
// manifest.json at the zip root. Run via `npm run package`.
// Only files tracked by git go in, in sorted order, so stray local files never
// ship and the same commit gives the same file list.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const out = resolve(`builds/tab-mission-${version}.zip`);

const dirty = execFileSync('git', ['status', '--porcelain', '--', 'extension'], { encoding: 'utf8' }).trim();
if (dirty) console.warn(`warning: packaging uncommitted changes in extension/:\n${dirty}`);

const files = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: 'extension', encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .sort();

mkdirSync('builds', { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-X', '-q', out, '-@'], { cwd: 'extension', input: files.join('\n'), stdio: ['pipe', 'inherit', 'inherit'] });

console.log(`wrote ${out} (${files.length} files)`);
