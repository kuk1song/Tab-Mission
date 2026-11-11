// Measurement branch only (test/measure-install-timing), not for merge: sums
// up the INSTALL-TIMING lines that tests/e2e/fixtures.mjs prints, one per
// test, from saved logs (a CI log, `gh run view <id> --log`, or a local run's
// output), or from stdin when no file is named. Per OS and project: count,
// min, median, p95, p99 and max of each interval, then the slowest tests.
//   node scripts/install-timing-summary.mjs run.log [more.log ...] [--by tipsWaitMs] [--top 5]
import { readFileSync } from 'node:fs';

const MARKER = 'INSTALL-TIMING ';

// Each interval: its name, and how to read it from a line (null when the
// line has no value for it). Fields are milliseconds from the start of the
// browser's launch (see fixtures.mjs); the rest are differences of them.
const diff = (a, b) => (line) => (line[a] === null || line[b] === null || line[a] === undefined || line[b] === undefined ? null : line[a] - line[b]);
const field = (name) => (line) => line[name] ?? null;
const INTERVALS = [
  ['launchMs', field('launchMs')],
  ['swOriginMs', field('swOriginMs')],
  ['swScriptMs', field('swScriptMs')],
  ['swMs', field('swMs')],
  ['installedMs', field('installedMs')],
  ['tipsWrittenMs', field('tipsWrittenMs')],
  ['welcomeCreatedMs', field('welcomeCreatedMs')],
  ['welcomeOriginMs', field('welcomeOriginMs')],
  ['welcomeLoadedMs', field('welcomeLoadedMs')],
  ['welcomeShownMs', field('welcomeShownMs')],
  ['welcomeMs', field('welcomeMs')],
  ['tipsMs', field('tipsMs')],
  ['tipsWaitMs (5 s on main)', field('tipsWaitMs')],
  ['setMs (install to write resolved)', field('setMs')],
  ['installedMs - swOriginMs', diff('installedMs', 'swOriginMs')],
  ['welcomeShownMs - welcomeOriginMs', diff('welcomeShownMs', 'welcomeOriginMs')],
  ['welcomeMs - tipsWrittenMs', diff('welcomeMs', 'tipsWrittenMs')],
  ['tipsMs - tipsWrittenMs', diff('tipsMs', 'tipsWrittenMs')],
  ['tipsPolls', field('tipsPolls')],
  ['tipsEvalMaxMs', field('tipsEvalMaxMs')],
  ['tipsGetMaxMs', field('tipsGetMaxMs')],
];

function parseArgs(argv) {
  const options = { files: [], by: 'tipsWaitMs', top: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--by') options.by = argv[++i];
    else if (argv[i] === '--top') options.top = Number(argv[++i]);
    else options.files.push(argv[i]);
  }
  return options;
}

// The lines with the marker, wherever it sits in a log line (GitHub's logs
// put a time stamp, and `gh run view --log` the job and step, before it).
function readLines(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const at = raw.indexOf(MARKER);
    if (at === -1) continue;
    const json = raw.slice(at + MARKER.length).trim();
    try {
      lines.push(JSON.parse(json));
    } catch {
      console.error(`skipped, not JSON: ${json.slice(0, 120)}`);
    }
  }
  return lines;
}

// Nearest rank: the smallest value with at least p of the values at or below it.
function percentile(sorted, p) {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function pad(value, width) {
  return String(value).padStart(width);
}

function summary(lines, { by, top }) {
  const groups = new Map();
  for (const line of lines) {
    const key = `${line.os} ${line.project}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const retries = group.filter((line) => line.retry > 0).length;
    const notOk = group.filter((line) => line.status !== 'passed').length;
    console.log(`\n== ${key}: ${group.length} lines (${retries} retries, ${notOk} not passed)`);
    console.log(`${'interval'.padEnd(36)}${pad('count', 6)}${pad('min', 8)}${pad('median', 8)}${pad('p95', 8)}${pad('p99', 8)}${pad('max', 8)}${pad('missing', 9)}`);
    for (const [name, read] of INTERVALS) {
      const values = group.map(read).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      const missing = group.length - values.length;
      if (!values.length) {
        console.log(`${name.padEnd(36)}${pad(0, 6)}${pad('', 40)}${pad(missing, 9)}`);
        continue;
      }
      const stats = [values[0], percentile(values, 0.5), percentile(values, 0.95), percentile(values, 0.99), values.at(-1)];
      console.log(`${name.padEnd(36)}${pad(values.length, 6)}${stats.map((v) => pad(v, 8)).join('')}${pad(missing, 9)}`);
    }
    // A line without the value (the step never came) counts as the slowest.
    const value = (line) => (typeof line[by] === 'number' ? line[by] : Infinity);
    const slowest = [...group].sort((a, b) => value(b) - value(a)).slice(0, top);
    console.log(`slowest ${slowest.length} by ${by}:`);
    for (const line of slowest) {
      const shown = typeof line[by] === 'number' ? `${line[by]} ms` : 'not reached';
      console.log(`  ${shown.padStart(11)}  ${line.test} (retry ${line.retry}, ${line.status}; sw ${line.swMs}, welcome ${line.welcomeMs}, tips ${line.tipsMs}, set ${line.setMs}, polls ${line.tipsPolls}, slowest get ${line.tipsGetMaxMs})`);
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const text = options.files.length
  ? options.files.map((file) => readFileSync(file, 'utf8')).join('\n')
  : readFileSync(0, 'utf8');
const lines = readLines(text);
if (!lines.length) {
  console.error(`no ${MARKER.trim()} lines found`);
  process.exit(1);
}
summary(lines, options);
