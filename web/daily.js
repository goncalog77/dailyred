// The daily game and the player's stats, saved in this browser (localStorage).
//
// Your team is random, but fixed for the whole calendar day (in your own time
// zone): reopening the site replays the same team until midnight, and each
// new day rolls a fresh one. Each browser gets one battle with RED per day.

const STORAGE_KEY = 'dailyred-stats';
const SEEDS_KEY = 'dailyred-day-seeds';

// A date in the player's time zone, e.g. "2026-10-11".
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`); // midday, so DST changes can't skip a day
  d.setDate(d.getDate() + days);
  return today(d);
}

// Your team seed for a date: rolled once at random, then kept for the rest
// of the day, so the team sticks around no matter how often you reopen the
// site. A new day always rolls a different team than yesterday's.
let memorySeeds = null; // used when localStorage is blocked

function loadSeeds() {
  try {
    memorySeeds = { ...memorySeeds, ...JSON.parse(localStorage.getItem(SEEDS_KEY)) };
  } catch {
    // Storage blocked (e.g. some private modes): seeds last until the page closes.
  }
  return memorySeeds ?? {};
}

function randomSeed32() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  } catch {
    return 1 + Math.floor(Math.random() * 0xfffffffe);
  }
}

const validSeed = (s) => Number.isInteger(s) && s >= 1 && s <= 0xffffffff;

export function dailySeed(date) {
  const seeds = loadSeeds();
  if (!validSeed(seeds[date])) {
    let seed = 0;
    do {
      seed = randomSeed32();
    } while (seed === 0 || seed === seeds[addDays(date, -1)]);
    seeds[date] = seed;
    // Only today is ever replayed; drop anything over a week old.
    for (const key of Object.keys(seeds)) {
      if (key < addDays(date, -7)) delete seeds[key];
    }
    memorySeeds = { ...seeds };
    try {
      localStorage.setItem(SEEDS_KEY, JSON.stringify(seeds));
    } catch {
      // Storage blocked: the team still sticks around until the page closes.
    }
  }
  return seeds[date];
}

export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

// --- Stats ------------------------------------------------------------------
//   wins, losses     all-time
//   winStreak        daily wins in a row
//   dayStreak        days played in a row
//   lastPlayed       date of the last finished battle, lastResult 'won'/'lost'
//   pending          date of a battle that started but hasn't finished

const EMPTY = { wins: 0, losses: 0, winStreak: 0, dayStreak: 0, lastPlayed: null, lastResult: null, pending: null };

let memoryCopy = null; // used when localStorage is blocked

export function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...EMPTY, ...saved };
  } catch {
    return { ...EMPTY, ...memoryCopy };
  }
}

function save(stats) {
  memoryCopy = { ...stats };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage blocked (e.g. some private modes): stats last until the page closes.
  }
}

// Today's result ('won' / 'lost'), or null if today's battle isn't done.
export function resultFor(stats, date) {
  return stats.lastPlayed === date ? stats.lastResult : null;
}

// Streaks as they stand on `date`: missing a day breaks them.
export function currentStreaks(stats, date) {
  const alive = stats.lastPlayed === date || stats.lastPlayed === addDays(date, -1);
  return { winStreak: alive ? stats.winStreak : 0, dayStreak: alive ? stats.dayStreak : 0 };
}

// From the moment RED's battle starts the day counts as played, so leaving
// mid-battle counts as a loss (see settleAbandonedGame).
export function markBattleStarted(stats, date) {
  if (stats.pending === date || resultFor(stats, date)) return;
  stats.pending = date;
  save(stats);
}

export function recordResult(stats, date, won) {
  if (stats.lastPlayed === date) return;
  const consecutive = stats.lastPlayed === addDays(date, -1);
  stats.dayStreak = consecutive ? stats.dayStreak + 1 : 1;
  if (won) {
    stats.wins++;
    stats.winStreak = consecutive && stats.lastResult === 'won' ? stats.winStreak + 1 : 1;
  } else {
    stats.losses++;
    stats.winStreak = 0;
  }
  stats.lastPlayed = date;
  stats.lastResult = won ? 'won' : 'lost';
  stats.pending = null;
  save(stats);
}

// A battle that started but never finished (tab closed, page reloaded) is a loss.
export function settleAbandonedGame(stats) {
  if (stats.pending && stats.pending !== stats.lastPlayed) {
    recordResult(stats, stats.pending, false);
  } else if (stats.pending) {
    stats.pending = null;
    save(stats);
  }
  return stats;
}
