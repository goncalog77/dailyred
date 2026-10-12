// Automated test verifying that refreshing the page resumes the exact game state
// both in the overworld and in battle, without restarting the game.
import {
  startServer, launchBrowser, sleep, getStatus, startRedBattle, forceWin, waitFor,
} from './lib.mjs';

const server = await startServer();
const browser = await launchBrowser();

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

async function attach(page) {
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { window.emu = window.dailyRed.emulator; });
  return waitFor(page, (s) => s.inOverworld || s.inBattle, { what: 'overworld or battle', timeoutMs: 30000 });
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // --- Test 1: Refreshing in overworld ---
  console.log('Test 1: Refreshing in overworld...');
  await page.goto(server.url);
  await page.click('#play');
  await attach(page);
  await waitFor(page, (s) => s.inOverworld, { what: 'overworld' });

  // Move player up
  await page.evaluate(() => window.emu.pressDown('up'));
  await sleep(400);
  await page.evaluate(() => window.emu.pressUp('up'));
  await sleep(1000);

  const beforeReload = await getStatus(page);
  console.log('Player coords before reload:', beforeReload.x, beforeReload.y);

  // Wait for auto-save to take effect (1.5s interval)
  await sleep(2000);

  // Reload the page
  await page.reload();

  // Should automatically resume without clicking #play!
  await attach(page);
  const afterReload = await getStatus(page);
  console.log('Player coords after reload:', afterReload.x, afterReload.y);

  check(afterReload.inOverworld, 'game resumed into overworld without restarting');
  check(afterReload.x === beforeReload.x && afterReload.y === beforeReload.y,
    `player kept exact same position (${afterReload.x}, ${afterReload.y})`);

  // --- Test 2: Refreshing mid-battle ---
  console.log('\nTest 2: Refreshing mid-battle...');
  await startRedBattle(page);
  await sleep(2000);
  const battleBefore = await getStatus(page);
  check(battleBefore.inBattle, 'battle with RED is active');

  // Wait for auto-save
  await sleep(2000);

  // Reload while in battle
  await page.reload();

  // Automatically resumes into battle!
  await attach(page);
  const battleAfter = await getStatus(page);
  check(battleAfter.inBattle, 'reloading mid-battle resumed directly inside battle');

  // --- Test 3: Finishing battle clears active session ---
  console.log('\nTest 3: Finishing battle clears state...');
  await forceWin(page);

  // Press A until game ends and returns to title
  for (let i = 0; i < 100; i++) {
    const appState = await page.evaluate(() => document.querySelector('.app').dataset.state);
    if (appState === 'title') break;
    await page.evaluate(() => window.emu?.press('a', 1, 60));
    await sleep(400);
  }

  const finalState = await page.evaluate(() => document.querySelector('.app').dataset.state);
  check(finalState === 'title', 'game finished and returned to title card');

  // Reloading now should stay on title card
  await page.reload();
  await sleep(1000);
  const reloadedFinalState = await page.evaluate(() => document.querySelector('.app').dataset.state);
  check(reloadedFinalState === 'title', 'reloading after game ended stays on title card (session cleared)');

  await context.close();
} catch (err) {
  failures++;
  console.error('FAIL Exception:', err);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll refresh persistence checks passed!');
process.exit(failures ? 1 : 0);
