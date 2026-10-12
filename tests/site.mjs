// Website test: drives index.html like a player would and checks the daily
// game across several (faked) days: stats, one battle per day, win / loss /
// abandoned battles, streaks, practice runs, the phone layout and the error
// screen. Screenshots go to tests/output/site-*.png.
import { mkdirSync } from 'node:fs';
import {
  startServer, launchBrowser, sleep, press, getStatus, waitFor, startRedBattle, forceWin, forceLoss,
} from './lib.mjs';
import { readParty } from './party.mjs';

const OUT = new URL('./output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

const DAY1 = '2026-10-11', DAY2 = '2026-10-12', DAY3 = '2026-10-13', DAY5 = '2026-10-15';
const at = (date, time = '10:00:00') => new Date(`${date}T${time}`);

const state = (page) => page.evaluate(() => document.querySelector('.app').dataset.state);
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dailyred-stats') || 'null'));
const shown = (page) => page.evaluate(() => ({
  wins: document.getElementById('stat-wins').textContent,
  losses: document.getElementById('stat-losses').textContent,
  winStreak: document.getElementById('stat-win-streak').textContent,
  dayStreak: document.getElementById('stat-day-streak').textContent,
  canPlay: !document.getElementById('play').hidden,
  played: document.getElementById('played').hidden ? null : document.getElementById('played-result').textContent,
  next: document.getElementById('played-next').textContent,
}));
const statLine = (s) => `${s.wins}W ${s.losses}L, win streak ${s.winStreak}, day streak ${s.dayStreak}`;

// The test helpers talk to window.emu; point it at the site's emulator.
async function attach(page) {
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { window.emu = window.dailyRed.emulator; });
  return waitFor(page, (s) => s.inOverworld, { what: 'overworld', timeoutMs: 30000 });
}

// Presses A through the end of the battle and the closing messages until the
// site has closed the game and is back on the title card.
async function finishDailyGame(page, shotPrefix) {
  for (let i = 0; i < 120; i++) {
    if ((await state(page)) === 'title') return true;
    if (shotPrefix && i % 3 === 0) await page.locator('canvas').first().screenshot({ path: `${OUT}/${shotPrefix}-${String(i).padStart(3, '0')}.png` }).catch(() => {});
    await press(page, 'a');
    await sleep(400);
  }
  return false;
}

const server = await startServer();
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Day 1: a fresh visitor.
  await page.clock.setFixedTime(at(DAY1));
  await page.goto(server.url);
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/site-title.png`, fullPage: true });
  let s = await shown(page);
  check(s.canPlay && s.wins === '0' && s.losses === '0' && s.winStreak === '0' && s.dayStreak === '0', `new visitor sees Play and zeroed stats (${statLine(s)})`);
  check(await page.evaluate(() => document.querySelector('.red-sprite').naturalWidth === 64), "RED's sprite is shown on the title card");
  const leftovers = await page.evaluate(() => ['.tagline', '.steps', '#seed', '#new-run'].filter((sel) => document.querySelector(sel)));
  check(leftovers.length === 0, `removed: tagline, how-it-works, seed, New run (${leftovers.join(', ') || 'none left'})`);
  const footer = await page.evaluate(() => document.querySelector('.footer')?.textContent || '');
  check(/unofficial fan project/.test(footer) && /not affiliated|isn't affiliated/.test(footer), 'footer shows the fan-project disclaimer');
  const licenses = await page.evaluate(async () => {
    const link = document.querySelector('.footer a[href="licenses.txt"]');
    return link ? (await fetch(link.href)).status : 0;
  });
  check(licenses === 200, `footer links to licenses.txt (status ${licenses})`);
  check(!(await page.locator('.pad').isVisible()), 'touch controls are hidden on desktop');

  await page.click('#play');
  await attach(page);
  await page.keyboard.press('q'); // trusted input: fires the site's audio-resume handler
  await sleep(500);
  const audio = await page.evaluate(() => window.dailyRed.audio());
  check(audio.length >= 1 && audio.every((s) => s === 'running'), `emulator audio is running (${audio.join(', ') || 'no audio contexts'})`);
  // Extra shortcuts: Enter confirms like A, Escape cancels like B. Spy on
  // the emulator API the site's handlers call through.
  async function keysThrough(code) {
    await page.evaluate(() => {
      window.__seen = [];
      const emu = window.emu;
      if (!emu.__origPress) {
        emu.__origPress = { down: emu.pressDown.bind(emu), up: emu.pressUp.bind(emu) };
        emu.pressDown = (b, ...rest) => { window.__seen.push(`down:${b}`); return emu.__origPress.down(b, ...rest); };
        emu.pressUp = (b, ...rest) => { window.__seen.push(`up:${b}`); return emu.__origPress.up(b, ...rest); };
      }
      window.__seen.length = 0;
    });
    await page.keyboard.down(code);
    await sleep(300);
    await page.keyboard.up(code);
    return page.evaluate(() => window.__seen.join(','));
  }
  check(await keysThrough('Enter') === 'down:a,up:a', 'Enter confirms like the A button');
  check(await keysThrough('Escape') === 'down:b,up:b', 'Escape cancels like the B button');
  await page.evaluate(() => {
    const emu = window.emu;
    emu.pressDown = emu.__origPress.down;
    emu.pressUp = emu.__origPress.up;
    delete emu.__origPress;
  });
  // Space is Start: it opens the menu (the player can't walk while it's
  // open), and Escape backs out again. Holds, not taps: the core samples
  // input once per frame and misses anything shorter.
  async function heldKey(code) {
    await page.keyboard.down(code);
    await sleep(400);
    await page.keyboard.up(code);
  }
  const yBeforeMenu = (await getStatus(page)).y;
  await heldKey('Space');
  await sleep(800);
  await page.evaluate(() => window.emu.pressDown('up'));
  await sleep(600);
  await page.evaluate(() => window.emu.pressUp('up'));
  await sleep(300);
  const menuOpened = (await getStatus(page)).y === yBeforeMenu;
  check(menuOpened, 'Space opens the menu (the player cannot walk while it is open)');
  await heldKey('Escape');
  await sleep(800);
  await page.evaluate(() => window.emu.pressDown('up'));
  await sleep(600);
  await page.evaluate(() => window.emu.pressUp('up'));
  await sleep(300);
  check(menuOpened && (await getStatus(page)).y < yBeforeMenu, 'Escape closes the menu (the player walks again)');
  const box = await page.locator('canvas').boundingBox();
  check(Math.round(box.width) === 720 && Math.round(box.height) === 480, `game screen is 720x480 on desktop (got ${box.width}x${box.height})`);
  const team1 = JSON.stringify(readParty((await getStatus(page)).mem).party.map((m) => m.species));

  // Your team sticks around all day: a second tab replays the same Pokemon.
  const tab2 = await context.newPage();
  await tab2.goto(server.url);
  await tab2.click('#play');
  await attach(tab2);
  check(JSON.stringify(readParty((await getStatus(tab2)).mem).party.map((m) => m.species)) === team1, 'reopening the site replays your team for the rest of the day');
  await tab2.close();

  await startRedBattle(page);
  await sleep(1000);
  check((await saved(page))?.pending === DAY1, 'once the battle starts, today counts as played');
  await forceWin(page);
  check(await finishDailyGame(page, 'site-win'), 'after a win the site closes the game and returns to the title card');
  s = await shown(page);
  check(s.wins === '1' && s.losses === '0' && s.winStreak === '1' && s.dayStreak === '1', `win recorded (${statLine(s)})`);
  check(!s.canPlay && s.played === 'You beat RED today!' && /^Next battle in \d\d:\d\d:\d\d$/.test(s.next), `no Play button; shows "${s.played}" / "${s.next}"`);
  await page.screenshot({ path: `${OUT}/site-played.png`, fullPage: true });

  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(!s.canPlay && s.wins === '1', 'reloading the same day keeps it locked, stats saved');
  const cacheKeys = await page.evaluate(async () => { try { return await caches.keys(); } catch { return []; } });
  check(cacheKeys.some((k) => k.startsWith('dailyred-')), `game files persist in the Cache API (${cacheKeys.join(', ') || 'none'})`);

  // Second chance, just for fun: a rematch with a brand-new team that
  // records nothing and keeps the daily lock.
  check(await page.locator('#try-again').isVisible(), 'after playing, a second chance is offered');
  await page.click('#try-again');
  await attach(page);
  check(JSON.stringify(readParty((await getStatus(page)).mem).party.map((m) => m.species)) !== team1, 'the rematch deals a new team');
  await startRedBattle(page);
  await forceWin(page);
  check(await finishDailyGame(page), 'after the rematch the site returns to the title card');
  s = await shown(page);
  check(s.wins === '1' && s.losses === '0' && s.winStreak === '1' && s.dayStreak === '1', `rematch is not recorded (${statLine(s)})`);
  check(!s.canPlay && s.played === 'You beat RED today!', 'still locked to one daily battle');
  check((await saved(page))?.pending == null, 'no pending battle left behind');
  check(await page.locator('#try-again').isVisible(), 'the second chance can be replayed');

  // Your team is yours alone: a second browser rolls a different one.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.clock.setFixedTime(at(DAY1, '22:00:00'));
  await otherPage.goto(server.url);
  await otherPage.click('#play');
  await attach(otherPage);
  check(JSON.stringify(readParty((await getStatus(otherPage)).mem).party.map((m) => m.species)) !== team1, 'a different visitor gets their own random team that day');
  await other.close();

  // Day 2: play again, lose.
  await page.clock.setFixedTime(at(DAY2));
  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(s.canPlay && s.winStreak === '1' && s.dayStreak === '1', `next day: Play is back, streaks kept (${statLine(s)})`);
  await page.click('#play');
  await attach(page);
  const team2 = JSON.stringify(readParty((await getStatus(page)).mem).party.map((m) => m.species));
  check(team2 !== team1, "a new day brings a new team");
  await startRedBattle(page);
  await forceLoss(page);
  check(await finishDailyGame(page, 'site-loss'), 'after a loss the site closes the game and returns to the title card');
  s = await shown(page);
  check(s.wins === '1' && s.losses === '1' && s.winStreak === '0' && s.dayStreak === '2', `loss recorded (${statLine(s)})`);
  check(s.played === 'RED won today.', `shows "${s.played}"`);

  // Day 3: leave in the middle of the battle -> counts as a loss.
  await page.clock.setFixedTime(at(DAY3));
  await page.reload();
  await page.click('#play');
  await attach(page);
  await startRedBattle(page);
  await sleep(1000);
  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(s.losses === '2' && s.dayStreak === '3' && !s.canPlay && s.played === 'RED won today.', `leaving mid-battle counts as a loss (${statLine(s)})`);

  // Day 5: a missed day resets the streaks.
  await page.clock.setFixedTime(at(DAY5));
  await page.reload();
  await sleep(800);
  s = await shown(page);
  check(s.canPlay && s.winStreak === '0' && s.dayStreak === '0' && s.wins === '1' && s.losses === '2', `missing a day resets the streaks (${statLine(s)})`);

  // Practice runs (?seed=) ignore the daily limit and never touch the stats.
  await page.clock.setFixedTime(at(DAY3));
  await page.goto(`${server.url}/?seed=777`);
  await sleep(800);
  check(await page.locator('#practice-note').isVisible() && await page.locator('#play').isVisible(), 'practice run: Play is available, with a note');
  const before = JSON.stringify(await saved(page));
  await page.click('#play');
  await attach(page);
  await startRedBattle(page);
  await sleep(1000);
  check(JSON.stringify(await saved(page)) === before, 'practice battles are not recorded');
  check(errors.length === 0, `no page errors (${errors.join('; ') || 'none'})`);
  await context.close();

  // Phone: layout and touch controls.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await phoneContext.newPage();
  await phone.goto(server.url);
  await sleep(1000);
  // Viewport-only screenshots: a fullPage capture resizes the viewport, which
  // makes Chromium drop the emulated touch pointer for the rest of the page.
  await phone.screenshot({ path: `${OUT}/site-phone-title.png` });
  check(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'no horizontal scrolling on a phone');
  const fits = await phone.evaluate(() => {
    const card = document.querySelector('.card-title').getBoundingClientRect();
    return [...document.querySelectorAll('.card-title > :not(.snow):not([hidden])')].every((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= card.top - 1 && r.bottom <= card.bottom + 1;
    });
  });
  check(fits, 'the title card fits inside the phone-sized screen');
  check(await phone.locator('.pad').isVisible(), 'touch controls are shown on a phone');
  check(await phone.locator('[data-button="l"]').isVisible() && await phone.locator('[data-button="r"]').isVisible(), 'L/R touch buttons are shown on a phone');
  await phone.click('#play');
  await attach(phone);
  await sleep(1500);
  const startY = (await getStatus(phone)).y;
  const dpad = await phone.locator('.dpad').boundingBox();
  await phone.mouse.move(dpad.x + dpad.width / 2, dpad.y + 10); // top arm of the d-pad
  await phone.mouse.down();
  await sleep(600);
  await phone.mouse.up();
  await sleep(600);
  const endY = (await getStatus(phone)).y;
  check(endY < startY, `touch d-pad moves the player (y ${startY} -> ${endY})`);
  // The Start pill opens the menu (walking blocked), the B pill closes it.
  // Holds, not taps: the core samples input once per frame.
  async function holdPill(selector) {
    const box = await phone.locator(selector).boundingBox();
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await sleep(400);
    await phone.mouse.up();
    await sleep(800);
  }
  async function holdUpOnDpad() {
    await phone.mouse.move(dpad.x + dpad.width / 2, dpad.y + 10);
    await phone.mouse.down();
    await sleep(600);
    await phone.mouse.up();
    await sleep(300);
  }
  await holdPill('[data-button="start"]');
  await holdUpOnDpad();
  const menuOpen = (await getStatus(phone)).y === endY;
  check(menuOpen, 'touch Start opens the menu (the player cannot walk while it is open)');
  await holdPill('[data-button="b"]');
  await holdUpOnDpad();
  check(menuOpen && (await getStatus(phone)).y < endY, 'touch B closes the menu (the player walks again)');
  await phone.screenshot({ path: `${OUT}/site-phone-playing.png` });
  await phoneContext.close();

  // A failed download shows the error card, and Try again recovers.
  const brokenContext = await browser.newContext();
  const broken = await brokenContext.newPage();
  await broken.route('**/game/*.gba.gz', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await broken.goto(server.url);
  await broken.click('#play');
  await broken.waitForFunction(() => document.querySelector('.app').dataset.state === 'error');
  const message = await broken.locator('#error-text').textContent();
  check(message.includes('HTTP 404'), `download failure shows an error ("${message}")`);
  await broken.unroute('**/game/*.gba.gz');
  await broken.click('#retry');
  await attach(broken);
  check(true, 'Try again starts the game after the error');
  await brokenContext.close();
} catch (err) {
  failures++;
  console.log('FAIL ', err.message);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
