// Cross-browser check: boots the site in each installed browser engine and
// verifies the game reaches the overworld on desktop and on a phone layout,
// plus the gzip fallback for browsers without DecompressionStream.
//
//   pnpm compat                    # every engine found (chromium, firefox, webkit)
//   BROWSER=firefox pnpm compat    # just one engine
//
// Chromium uses your installed Chrome (CHROME_PATH); Firefox/WebKit use
// Playwright's bundled builds (npx playwright install firefox webkit).
// Screenshots go to tests/output/compat-*.png.
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findChrome, startServer, launchBrowser, sleep, getStatus, waitFor } from './lib.mjs';

const OUT = new URL('./output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ALL_KINDS = ['chromium', 'firefox', 'webkit'];

function kindAvailable(kind) {
  if (kind === 'chromium') {
    try {
      findChrome();
      return true;
    } catch {
      return false;
    }
  }
  try {
    return readdirSync(join(homedir(), '.cache/ms-playwright')).some((d) => d.startsWith(`${kind}-`) || d.startsWith(`${kind}_`));
  } catch {
    return false;
  }
}

// Page errors fail the run, except the Wake Lock denial that headless
// Chromium produces from the vendored emulator (no Wake Lock code of ours).
const IGNORE_ERRORS = [/Wake Lock/i];

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

async function desktopPage(browser, server, kind, options = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (options.noDecompressionStream) {
    await page.addInitScript(() => {
      try {
        delete window.DecompressionStream;
      } catch { /* property not configurable: the fallback can't trigger here */ }
    });
  }
  await page.goto(server.url);
  await sleep(1200);
  check(await page.evaluate(() => document.querySelector('.app')?.dataset.state) === 'title', `[${kind}] title card renders`);
  check(await page.locator('#play').isVisible(), `[${kind}] Play is visible`);
  await page.click('#play');
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { window.emu = window.dailyRed.emulator; });
  const s = await waitFor(page, (st) => st.inOverworld, { what: 'overworld', timeoutMs: 90000 });
  check(true, `[${kind}] game boots to the overworld (player at ${s.x},${s.y})`);
  await page.locator('canvas').first().screenshot({ path: `${OUT}/compat-${kind}-overworld.png` }).catch(() => {});
  const fresh = errors.filter((e) => !IGNORE_ERRORS.some((re) => re.test(e)));
  check(fresh.length === 0, `[${kind}] no page errors (${fresh.join('; ') || 'none'})`);
  await page.close();
}

async function mobilePage(browser, server, kind) {
  // Firefox can't emulate a coarse pointer headlessly (no isMobile), so the
  // touch pad stays hidden there; real mobile Firefox reports a coarse
  // pointer and shows it, like every other mobile browser.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(kind === 'firefox' ? {} : { isMobile: true }),
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const phone = await context.newPage();
  phone.on('pageerror', () => {});
  await phone.goto(server.url);
  await sleep(1200);
  check(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, `[${kind}] no horizontal scrolling on a phone`);
  if (kind === 'firefox') {
    console.log('SKIP  [firefox] touch pad visibility (see above)');
  } else {
    check(await phone.locator('.pad').isVisible(), `[${kind}] touch controls are shown on a phone`);
  }
  await phone.tap('#play');
  await phone.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
  await phone.evaluate(() => { window.emu = window.dailyRed.emulator; });
  await waitFor(phone, (s) => s.inOverworld, { what: 'overworld', timeoutMs: 90000 });
  check(true, `[${kind}] phone boots to the overworld via touch`);
  await phone.screenshot({ path: `${OUT}/compat-${kind}-phone.png` }).catch(() => {});
  await context.close();
}

const only = (process.env.BROWSER || '').toLowerCase();
const kinds = (only ? [only] : ALL_KINDS).filter((kind) => {
  if (!ALL_KINDS.includes(kind)) {
    console.log(`FAIL  unknown BROWSER=${process.env.BROWSER} (want chromium, firefox or webkit)`);
    failures++;
    return false;
  }
  if (!kindAvailable(kind)) {
    console.log(`SKIP  ${kind}: browser not installed`);
    return false;
  }
  return true;
});

const server = await startServer();
for (const kind of kinds) {
  process.env.BROWSER = kind;
  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.log(`SKIP  ${kind}: cannot launch (${String(err.message || err).split('\n')[0]})`);
    continue;
  }
  try {
    console.log(`\n===== ${kind} =====`);
    await desktopPage(browser, server, kind);
    await mobilePage(browser, server, kind);
    if (kind === 'chromium') {
      // Legacy path: no DecompressionStream, so the ROM must unpack through
      // the vendored fflate instead.
      await desktopPage(browser, server, `${kind}+fflate`, { noDecompressionStream: true });
    }
  } catch (err) {
    failures++;
    console.log(`FAIL  [${kind}] ${err.message}`);
  } finally {
    await browser.close();
  }
}
server.close();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll compat checks passed');
process.exit(failures ? 1 : 0);
