// One command for every Daily Red test suite:
//
//   pnpm test:all                        # smoke + site + teams (10 random seeds)
//   pnpm test:all -- --teams-random 40   # thorough team check (~like the README's stats)
//   node test-all.mjs --skip-site --skip-teams
//   node test-all.mjs --skip-smoke --skip-site --teams-random 5
//
// Checks prerequisites first (built ROM, vendor files, Chrome, dependencies)
// and prints exactly which setup step is missing, instead of failing obscurely.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, ROOT } from './lib.mjs';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node test-all.mjs [options]

Runs every Daily Red test suite: smoke (game loop), site (website), teams (generator).

Options:
  --skip-smoke        skip tests/smoke.mjs
  --skip-site         skip tests/site.mjs
  --skip-teams        skip tests/teams.mjs
  --teams-random <n>  number of random seeds for teams.mjs (default 10)
  --help              show this message`);
  process.exit(0);
}

const skipSmoke = args.includes('--skip-smoke');
const skipSite = args.includes('--skip-site');
const skipTeams = args.includes('--skip-teams');
let teamsRandom = 10;
const randomIdx = args.indexOf('--teams-random');
if (randomIdx >= 0) {
  teamsRandom = Number(args[randomIdx + 1]);
  if (!Number.isInteger(teamsRandom) || teamsRandom < 1) {
    console.log('FAIL  --teams-random needs a positive integer');
    process.exit(1);
  }
}

// --- Suites ------------------------------------------------------------------
const suites = [
  ...(skipSmoke ? [] : [{ name: 'smoke', cmd: [process.execPath, 'smoke.mjs'] }]),
  ...(skipSite ? [] : [{ name: 'site', cmd: [process.execPath, 'site.mjs'] }]),
  ...(skipTeams ? [] : [{ name: 'teams', cmd: [process.execPath, 'teams.mjs', '--random', String(teamsRandom)] }]),
];
if (!suites.length) {
  console.log('Nothing to run: every suite was skipped.');
  process.exit(0);
}

// --- Prerequisites -----------------------------------------------------------
const missing = [];
const hint = (ok, message) => { if (!ok) missing.push(message); };

hint(existsSync(join(TESTS_DIR, 'node_modules/playwright-core')), "test dependencies missing. Run: pnpm install");
hint(existsSync(join(ROOT, 'pokefirered')), "pokefirered/ missing. Run: scripts/get-pokefirered.sh");
hint(existsSync(join(ROOT, 'pokefirered/pokefirered_modern.elf')), "built ROM missing. Run: scripts/setup.sh, then scripts/build-rom.sh");
let manifestRom = null;
try {
  manifestRom = JSON.parse(readFileSync(join(ROOT, 'web/game/manifest.json'), 'utf8')).rom;
} catch { /* reported below */ }
hint(typeof manifestRom === 'string' && manifestRom && existsSync(join(ROOT, 'web/game', manifestRom)), "website ROM copy missing. Run: scripts/build-rom.sh");
for (const f of ['nostalgist.js', 'mgba_libretro.js', 'mgba_libretro.wasm', 'pixelify-sans.woff2', 'vercel-analytics.js', 'fflate.js']) {
  hint(existsSync(join(ROOT, 'web/vendor', f)), `web/vendor/${f} missing. Run: scripts/fetch-vendor.sh`);
}
try {
  findChrome();
} catch {
  missing.push("Chrome/Chromium not found. Install Google Chrome or set CHROME_PATH to its binary.");
}

if (missing.length) {
  for (const m of missing) console.log(`FAIL  ${m}`);
  console.log(`\n${missing.length} prerequisite(s) missing`);
  process.exit(2);
}

function run({ name, cmd }) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n===== ${name}: ${cmd.join(' ')} =====`);
    const child = spawn(cmd[0], cmd.slice(1), { cwd: TESTS_DIR, stdio: 'inherit' });
    child.on('error', (err) => resolve({ name, ok: false, secs: 0, error: err.message }));
    child.on('close', (code) => resolve({ name, ok: code === 0, secs: Math.round((Date.now() - started) / 1000) }));
  });
}

const results = [];
for (const suite of suites) results.push(await run(suite));

console.log('\n===== test-all summary =====');
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.secs}s)${r.error ? `: ${r.error}` : ''}`);
  if (!r.ok) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
