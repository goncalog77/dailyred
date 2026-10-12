# Daily Red

A daily Pokémon battle in the browser, like Wordle: once a day you press
**Play**, get your own six random level 100 Pokémon from Generations 1–3
(a new random team every day, yours alone), and climb to RED at the top of
the mountain. You get one battle per day — plus, once you've played, an
unrecorded rematch with a fresh team just for fun. Your wins, losses, win streak and daily
play streak are kept in your browser.

Every battle runs on the original Pokémon FireRed engine: the game is the
[pret/pokefirered](https://github.com/pret/pokefirered) decompilation with a
small set of source changes, built into a GBA ROM and played in the browser
through the mGBA emulator compiled to WebAssembly. Nothing about battles is
reimplemented in JavaScript.

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Team generation](#team-generation)
- [RED's team](#reds-team)
- [Development workflow](#development-workflow)
- [Testing and debugging](#testing-and-debugging)
- [Running it locally](#running-it-locally)
- [Deploy on Vercel](#deploy-on-vercel)
- [Copyright and licenses](#copyright-and-licenses)
- [Known limitations](#known-limitations)

## Quick start

You need Node.js 18+, git, and a native C toolchain (compiler, `make`,
`curl`, `unzip`). No **ROM**: the decompilation builds the whole game from
source.

- **macOS:** the Xcode Command Line Tools (`xcode-select --install`).
- **Linux:** e.g. `sudo apt install build-essential` (Debian/Ubuntu),
  `sudo dnf install gcc make` (Fedora) or `sudo pacman -S base-devel`
  (Arch).
- **Windows:** run the commands below from Git Bash (ships with
  [Git for Windows](https://git-scm.com/)) or WSL2, with a native C compiler
  available (e.g. MSYS2's `pacman -S base-devel`).

```sh
scripts/start.sh              # everything below, then open http://localhost:8080
```

That one command installs the toolchain, fetches the game source and vendor
files (skipping steps that are already done), rebuilds the ROM and serves the
site. Pass a port to use another one: `scripts/start.sh 3000`. The same steps
manually:

```sh
scripts/setup.sh            # ARM cross-compiler + libpng into .toolchain/ (~1 GB, one time)
scripts/get-pokefirered.sh  # pret/pokefirered at a pinned commit + patches/
scripts/fetch-vendor.sh     # emulator, emulator core and font into web/vendor/
scripts/build-rom.sh        # builds the ROM, writes web/game/dailyred.<hash>.gba.gz
node scripts/serve.mjs      # open http://localhost:8080
```

`setup.sh` picks the right compiler archive for your OS and CPU
(Intel / Apple Silicon Macs, x86_64 / ARM Linux, 64-bit Windows).
(`scripts/setup-macos.sh` still works as an alias for it.)

## How it works

```
pret/pokefirered @ 037335f + patches/  ──make modern──▶  pokefirered_modern.gba
                                                              │ gzip (16 MB → 5.5 MB)
web/ (static files)                                           ▼
  index.html + app.js ── fetch ──▶ game/manifest.json → game/dailyred.<hash>.gba.gz, vendor/mgba_libretro.wasm
        │  writes the day's seed + your record into the ROM bytes (rom-config.js)
        ▼
  Nostalgist.js ──▶ RetroArch + mGBA core (WebAssembly) ──▶ <canvas>
        ▲
        └─ game-link.js reads the battle's status from the game's RAM
           → daily.js updates your stats in localStorage
```

**Why an emulator instead of compiling the C to WebAssembly:** the decomp is
written for GBA hardware (video, DMA, interrupts, the m4a sound engine,
ARM/Thumb assembly). Running the real ROM in mGBA keeps the battle engine,
animations and sound exactly as shipped, with no porting work. mGBA has a
built-in BIOS replacement, so no BIOS file is needed either.

**Why Nostalgist + RetroArch's mGBA core:** it accepts the ROM as raw bytes
(needed for the config below), exposes button presses and the emulator's
memory to JavaScript, and doesn't need `SharedArrayBuffer`, so a plain static
file server works without special headers. Everything loads from `web/vendor/`.

### The daily game

- **The day's team:** your seed is rolled at random on your first visit each
  day and kept in your browser (`dailySeed` in `web/daily.js`, localStorage
  key `dailyred-day-seeds`), so reopening the site replays your team all day
  and every day brings a fresh one. The day changes at your local midnight.
- **Site → game:** the ROM contains a small struct, `gDailyRedRomConfig`: the
  magic bytes `DAILYRED-CONF-V2`, then the seed, the player's wins and battles
  so far, and a "daily" flag. Before booting, `web/rom-config.js` finds the
  magic bytes in the downloaded ROM and fills them in; no addresses are
  hard-coded on either side. The game uses the record for its "Record: x
  win(s) in x battle(s)" message.
- **Game → site:** the game keeps a status block in RAM (`sStatus` in
  `src/dailyred.c`): the magic `DAILYRED-STATUS1`, the seed, a phase (exploring
  / battle / result / finished) and a result (won / lost). `web/game-link.js`
  finds it in the emulator's WebAssembly memory (the magic followed by the
  seed it injected) and reads it twice a second.
- **One battle a day:** the day counts as played as soon as RED's battle
  starts; closing or reloading the page mid-battle counts as a loss. The
  result is saved the moment it's known. After the closing messages the game
  fades to black and holds; the site then closes it and shows today's result
  and a countdown to the next battle. Before the battle you can reload freely:
  it's your team all day.
- **Second chance, just for fun:** once today's battle is done, "Try again
  for fun" deals a brand-new team for one more battle — all or nothing, no
  consequences. It runs as a daily-mode game (so it ends after one battle)
  but nothing is recorded and the daily lock is untouched; it can be replayed
  as often as you like.
- **Stats** (`web/daily.js`, localStorage key `dailyred-stats`): wins, losses,
  win streak (daily wins in a row) and day streak (days played in a row).
  Missing a day resets both streaks.
- **Without the website** (seed 0, e.g. the ROM in a desktop emulator): the
  normal intro and title screen appear, pressing Start seeds the game the way
  vanilla FireRed does, and after each battle a new team arrives.
- **`?seed=1234`** in the URL starts a practice run for testing: that seed's
  team, no daily limit, nothing saved, and a new team after each battle. It
  isn't shown anywhere in the UI.

### Game flow and the files involved

| Step | Code |
|---|---|
| Copyright screen → straight in (seed set) | `src/intro.c` → `CB2_DailyRed_StartFromCopyright` (`src/dailyred.c`) |
| Title screen → straight in (no seed) | `src/title_screen.c` → `CB2_DailyRed_StartFromTitle` |
| New game data: LEAF (FireRed's female player), fast text | `StartNewGame` in `src/dailyred.c`, then vanilla `CB2_NewGame` |
| Team + warp to the summit instead of the bedroom | `src/new_game.c` → `DailyRed_InitNewGame` |
| The summit: an open peak with no exits; stairs up to RED, who faces the drop | `data/maps/DailyRed_Summit/`, `data/layouts/DailyRed_Summit/` |
| Snow on the summit (fixes FireRed's unused snow weather, whose flakes never came back) | `src/field_weather_effects.c` |
| Talking to RED → battle → "You defeated RED!" / "Your team was wiped out…" → record → "Play again tomorrow!" / "Try again tomorrow." → fade out | `data/maps/DailyRed_Summit/scripts.inc` and `text.inc`; the `DailyRed_On*` specials in `src/dailyred.c` |
| Mountain battle background on the summit | `BattleSetup_GetTerrainId` in `src/battle_setup.c` |
| No free switch when RED's Pokémon faints: Battle Style starts on SET and is locked in Options | `StartNewGame` in `src/dailyred.c`, `src/option_menu.c` |
| RED as a trainer | `TRAINER_DAILYRED_RED` in `include/constants/opponents.h`, `src/data/trainers.h`, `src/dailyred_boss.c` |
| Menus: POKéMON / OPTION / EXIT; party: SUMMARY / SWITCH / CANCEL | `src/start_menu.c`, `src/party_menu.c`; window height for short menus in `src/new_menu_helpers.c` |
| RED's overworld sprite, in its own palette slot so it doesn't clash with LEAF's | `OBJ_EVENT_GFX_DAILYRED_RED` in `include/constants/event_objects.h`, `src/data/object_events/` |

The battle itself is a standard FireRed trainer battle. The map script uses
`trainerbattle_earlyrival` with `RIVAL_BATTLE_HEAL_AFTER`, the mode FireRed
uses for the rival fight in Oak's lab, so losing doesn't white out. The script
then reads `VAR_RESULT`, updates a win/battle counter, calls the
`DailyRed_StartNextRun` special (new team) and warps back to the start tile,
which also resets RED.

Every vanilla file that was changed has a `Daily Red:` comment at the change:

```sh
grep -rn "Daily Red" pokefirered/src pokefirered/include pokefirered/data
```

The summit layout is a copy of Navel Rock's summit (the peak where Ho-Oh
appears) with the arrival ladder removed. RED stands on the tip at (9, 11)
facing north, out over the drop, and turns around when you talk to him. The project uses pokefirered's `modern` target (GCC 14),
not the byte-matching `agbcc` build, so it doesn't reproduce the retail ROM.

## Team generation

`pokefirered/src/dailyred_team.c` builds each team with the decomp's own data
(`gLevelUpLearnsets`, `CanMonLearnTMHM`, the TM/HM move table,
`CreateMon`, `CalculateMonStats`):

- **Species:** 6 different Pokémon from all 386 of Generations 1–3 whose
  **base stat totals add up to at least 2700** (`MIN_TEAM_BASE_STAT_TOTAL`).
  **Legendaries are a 1-in-8 roll** (`LEGENDARY_TEAM_ODDS`): 1 team in 8 gets
  exactly one legendary or mythical Pokémon, in a random party slot, and the
  other 7 get none. The generator then redraws the rest of the team until it
  meets the minimum, so every qualifying team is equally likely. Per-species
  rules live in `IsEligibleSpecies`, e.g. add "fully evolved only" there.

  Why a minimum: RED's team totals 2954 (see below). A fully random team
  averages about 2430, and two thirds of them include a Pokémon under 300,
  which made most runs hopeless. A team can still include one weak Pokémon if
  the rest make up for it.

  Why legendaries are a separate roll: they average 613 against 393 for
  everything else, so a stat minimum on its own mostly gets met by drawing
  one. With a 2750 minimum alone, 70% of teams had a legendary and 20% had two
  or more.

  How the minimum sets the difficulty: with the IVs and EVs below, a team's
  actual in-battle stat total is almost exactly 2 × its base stat total +
  2580, and RED's is 8555. So each minimum gives:

  | Minimum | Typical team vs RED | Weakest possible | Teams stronger than RED |
  |---|---|---|---|
  | 2600 | 94% | 91% | about 1 in 45 |
  | 2650 | 95% | 92% | about 1 in 34 |
  | **2700** | **96%** | **93%** | **about 1 in 25** |
  | 2750 | 97% | 94% | about 1 in 17 |

  (Odds from simulating 80,000 teams.) Measured in the real ROM at 2700 over
  80 runs: typical team 95% of RED's stats, range 93–101%, 1 team stronger
  than RED. RED also has hand-picked moves, chosen held items (his Pikachu's
  Light Ball doubles its Sp. Atk) and the strongest trainer AI, so he stays
  the favourite.

- **Moves:** up to 4 different moves picked uniformly from everything the
  species can learn **by level-up (any level) or TM/HM**. One rule on top: if
  none of the four can deal damage and the species has any damaging move, one
  pick is swapped for a damaging move. Species with fewer than 4 learnable moves
  (Ditto, Unown, Magikarp, Smeargle…) get all of them.
- **Stats:** level 100, random personality (so random nature, gender, ability
  and the usual 1/8192 shiny chance), and trained close to RED's level:
  - **IVs** random from 25 to 31 in every stat (`MIN_TEAM_IV`); RED's are all 31.
  - **EVs** 252 into each of its two highest base stats and the last 6 into
    HP, or into its third-best stat if HP is one of the two
    (`AssignFocusedEVs`). Attack and Sp. Atk only count if one of its attacks
    uses them (in Gen 3 a move's type decides which), so a Gyarados with only
    Surf and Ice Beam doesn't waste points on Attack. Fast Pokémon end up as
    fast as RED's; slow walls put their points into bulk instead.

  The player is the original trainer, so everything obeys, and Pokémon are
  marked as event Pokémon so Mew and Deoxys obey too.
- **Held items:** each Pokémon holds one, picked uniformly from a pool of
  generally useful battle items (`sBattleItems`: Leftovers, Choice Band,
  Quick Claw, Lum Berry, pinch berries…) plus the 10% type booster for each
  type it actually attacks with (Charcoal only if it has a Fire attack, and
  so on). There are still no bag items.
- **Safety:** each Pokémon is validated (level, HP, at least one move, no
  duplicate moves, PP). If a Pokémon somehow failed 10 times, the game would
  use FireRed's own default level-100 moveset for it rather than hand over
  something broken.

Trade-offs in this first version: the move picker ignores move tutors and egg
moves (add them in `GetLearnableMoves`), and it's deliberately not
competitive. Splash, Water Sport or three status moves plus one attack are all
possible. Items are picked without looking at the moveset beyond type
boosters, so a Choice Band can land on a Pokémon that mostly uses status
moves, and species-specific items (Light Ball, Thick Club…) aren't in the pool.
The generator uses its own RNG state, separate from the game's `Random()`, so
teams depend only on the seed.

## RED's team

Edit **`pokefirered/src/dailyred_boss.c`**: species, level, IVs, held item and
moves use FireRed's normal `TrainerMonItemCustomMoves` format, plus an EV
table next to it. It's Red's Mt. Silver team from HeartGold/SoulSilver
(Pikachu, Espeon, Snorlax, Venusaur, Charizard, Blastoise) at level 100 with
perfect IVs, held items and full EV spreads. HGSS used several Gen 4 moves, so
the movesets are adapted to Gen 3 ones.

| Pokémon | HP | Atk | Def | Spe | SpA | SpD | Total |
|---|---|---|---|---|---|---|---|
| Pikachu (Light Ball doubles its Sp. Atk) | 35 | 55 | 30 | 90 | 50 | 40 | 300 |
| Espeon | 65 | 65 | 60 | 110 | 130 | 95 | 525 |
| Snorlax | 160 | 110 | 65 | 30 | 65 | 110 | 540 |
| Venusaur | 80 | 82 | 83 | 80 | 100 | 100 | 525 |
| Charizard | 78 | 84 | 78 | 100 | 109 | 85 | 534 |
| Blastoise | 79 | 83 | 100 | 78 | 85 | 105 | 530 |
| **Team** | | | | | | | **2954** |

These are Gen 3 base stats from `src/data/pokemon/species_info.h`. With your
team's IVs (25–31) and focused EVs, both sides get about the same out of their
base stats. Measured from game RAM, a 525-total Pokémon reaches about 1520
actual stat points for RED and about 1533 for you; his natures come from
FireRed's fixed formula and sometimes cut a stat he needs. (With fully random
IVs and EVs it was about 1445 for you, which made him much stronger point for
point.)

RED's name, trainer class ("PKMN TRAINER"), sprite and AI flags (the same as
FireRed's Champion) are in `[TRAINER_DAILYRED_RED]` in
`pokefirered/src/data/trainers.h`. He gets the Champion battle music
(`src/pokemon.c`). FireRed trainers have no EVs, so a 3-line hook in
`CreateNPCTrainerParty` (`src/battle_main.c`) applies the EV table. Natures
come from FireRed's usual name-based formula and aren't configurable.

## Development workflow

1. Edit files in `pokefirered/` (a git checkout of pret's repo).
2. `scripts/build-rom.sh` (incremental builds take a few seconds; a full
   rebuild from scratch takes under a minute on a modern desktop, and host
   tools reuse ccache when it's installed).
3. Reload the page. `scripts/serve.mjs` sends `Cache-Control: no-cache`.
4. When you're happy, run `scripts/save-patch.sh` and commit
   `patches/pokefirered-dailyred.patch`.

`pokefirered/`, `.toolchain/`, `web/vendor/` and `web/game/` are not tracked
(see `.gitignore`); a clean checkout recreates them with the scripts above.
`git -C pokefirered diff` shows all game changes against upstream.

To play the ROM outside the browser, open
`pokefirered/pokefirered_modern.gba` in mGBA or any GBA emulator. Without an
injected seed it boots to the title screen; press Start.

The website has no build step: plain HTML, CSS and ES modules in `web/`.

## Testing and debugging

The tests boot the real ROM in headless Chrome through the same emulator the
website uses, press buttons, and read game RAM out of emulator save states
(mGBA's state contains a raw copy of RAM).

```sh
pnpm install     # playwright-core only; it drives your installed Google Chrome
pnpm test:all    # every suite: smoke + site + teams on 10 random seeds
pnpm smoke       # the game loop (~3 min)
pnpm site        # the website on desktop and phone (~1 min)
pnpm teams -- 1 2 3            # print + validate the teams for these seeds
pnpm teams -- --random 40      # 40 random seeds
```

`pnpm test:all` runs all three suites in one command and checks the
prerequisites first (built ROM, `web/vendor/` files, Chrome, `pnpm install`),
telling you exactly which setup step to run when something is missing:

```sh
pnpm test:all -- --teams-random 40   # thorough team check
node tests/test-all.mjs --skip-site --teams-random 5
node tests/test-all.mjs --help                # all options
```

`pnpm compat` boots the site in every installed browser engine (desktop and
a phone layout, via touch) and checks the game reaches the overworld with no
page errors — including the gzip fallback for browsers without
`DecompressionStream`:

```sh
pnpm compat                    # chromium, firefox, webkit (whichever are installed)
BROWSER=firefox pnpm compat    # just one engine
```

Chromium uses your installed Chrome (`CHROME_PATH`); Firefox/WebKit use
Playwright's bundled builds (`npx playwright install firefox webkit`).

The tests need Google Chrome (or Chromium / Edge on Windows). The usual
install locations are detected automatically; otherwise point at your binary
with `CHROME_PATH`:

```sh
CHROME_PATH=/path/to/chrome pnpm test:all
```

`pnpm smoke` checks that:
- each seed's team is valid: 6 different real Gen 1–3 species with a combined
  base stat total of at least 2700 and at most one legendary, level 100, full
  HP, IVs 25–31, EVs exactly as `AssignFocusedEVs` would place them (checked
  by an independent JavaScript copy of the rule), an item from the pool (type boosters only with a
  matching attack), and every move learnable by the species. The
  learnable-move check parses the decomp's data files in JavaScript, so it's
  independent of the C generator.
- the same seed gives the same team, and different seeds give different ones.
- the player starts at the foot of the stairs, RED faces away from them (and
  again after every run), and talking to RED starts a trainer battle on the
  mountain background.
- battle style is SET from the start, the Options menu can't change it, and
  when one of RED's Pokémon is knocked out he sends the next one with no
  "Will LEAF change POKéMON?" prompt.
- L/R never open FireRed's built-in help (button mode is LR from the start
  and the Options menu can't change it), and holding B runs on the summit.
- RED's in-battle party is the configured team with IVs, items and EVs.
- a win and a loss are each handled: no white-out, counters updated, and a new
  valid team afterwards.
- the daily game starts from the website's record, reports the battle start,
  the result and the end, counts the battle in its record message, and
  ignores input once it's over (no second battle).
- without a seed, the title screen appears and Start leads into the game.

The win and loss are forced by editing HP values in a save state, which makes
them quick and deterministic. Screenshots of every step are saved in
`tests/output/`.

`pnpm site` plays the daily game over five faked days (Playwright's clock):
a fresh visitor, emulator audio running after a key press, game files cached
for repeat visits, a win (stats, locked until tomorrow, countdown, survives a
reload), a fun rematch with a new team (not recorded, lock kept), a different team for a second browser that day (but the same team in
a second tab), a loss the next day,
leaving mid-battle (counts as a loss), a missed day (streaks reset), and a
practice run (`?seed=`, not recorded). It also checks the 3× (720×480)
screen, RED's sprite, the phone layout and touch controls (d-pad, menu via
Start, L/R buttons), and the download-error
screen with "Try again".

**Checking by hand:** open `http://localhost:8080/?seed=42` for a practice run
(nothing saved, no daily limit). To reset your daily stats, run
`localStorage.removeItem('dailyred-stats')` in the browser console.

**In the browser console:** `dailyRed.emulator` is the running Nostalgist
instance and `dailyRed.stats` shows your saved stats.

## Running it locally

Daily Red is meant to be played on your own computer. After the quick start,
`web/` holds the whole site (about 9 MB), and `node scripts/serve.mjs` serves
it at http://localhost:8080. Repeat visits download almost nothing: the
emulator core is pinned, so it lives in the Cache API indefinitely, and the
ROM's content hash is in its filename — the site revalidates the tiny
`manifest.json` and only downloads the ROM when a rebuild changed it.

```
web/index.html  app.js  daily.js  game-link.js  game-files.js  rom-config.js  style.css  favicon.svg  licenses.txt
web/vendor/     emulator (3.4 MB) + font
web/game/       dailyred.<hash>.gba.gz (5.5 MB) + manifest.json, built on your machine
```

To use another port, pass it: `node scripts/serve.mjs 3000`. Your stats are
saved in the browser for that address, so keep using the same port to keep
your streaks. After rebuilding the ROM (`scripts/build-rom.sh`), reload the
page.

## Deploy on Vercel

The site is static files plus a build: push this repo to Vercel (dashboard →
Add New → Project → Import) and it builds and hosts itself. `vercel.json`
runs `scripts/vercel-build.sh` (toolchain + game source + vendor files + ROM,
all into `web/`), publishes `web/`, and sets long-lived caching on the
versioned vendor/core files while keeping `manifest.json` fresh. The first
deploy takes several minutes (the ARM toolchain is a ~280 MB download); later
deploys reuse nothing and rebuild from scratch, so expect the same each time.
No environment variables are needed. Your battle stats still live in each
visitor's browser (localStorage), not on the server. For traffic stats,
enable Web Analytics in the Vercel dashboard (project → Analytics → Enable):
the site already ships the tracking snippet (`web/vendor/vercel-analytics.js`,
via the `@vercel/analytics` dependency) and reports page views automatically.

To verify the exact deploy build locally first: `pnpm build`.

### Keep the deployment private

The deployed site serves a built Pokémon ROM, which is Nintendo's
copyrighted content — a public URL is a takedown risk no disclaimer can
remove. The safest way to play is locally (`scripts/start.sh`). If you
deploy, keep it private:

- Enable deployment protection (Vercel dashboard → project → Settings →
  Deployment Protection) and share the URL only with a few people.
- Use a neutral project/domain name — never one containing "Pokémon".
- The site already asks search engines to stay away (`web/robots.txt` plus a
  `noindex` meta tag); don't link it from public profiles.
- Never monetize it: no ads, donations, or paywalled access.
- If a takedown notice ever arrives, comply promptly: take the deployment
  down, don't counter-notice, and don't re-upload it elsewhere.

## Copyright and licenses

Daily Red is a free, unofficial fan project made just for fun —
non-commercial, with no profit of any kind. It isn't affiliated with or
endorsed by Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company.
Pokémon and all related names, characters and game content are © Nintendo,
Creatures Inc. and GAME FREAK inc. All rights reserved by their respective
owners.

Daily Red's original game, code and changes are ©
[amoi-builds](https://github.com/amoi-builds).

This repository contains Daily Red's own work: the changes in `patches/`, the
website and the tests. It doesn't include pret/pokefirered, a built ROM, or
any game assets; the scripts fetch the decompilation from pret's repository
and build everything locally on your own machine.

The emulator core is GPL-3.0 (RetroArch) and MPL-2.0 (mGBA). `web/licenses.txt`
lists all third-party components with links to their source, and the page
footer links to it.

## Known limitations

- **Movement:** hold B to run on the summit. There's no bike (no bag or
  items in this game), and running shoes were made for longer routes — the top
  is only a few steps away.
- **Stats live in the browser:** clearing site data resets them, they don't
  follow you to another device or browser, and anyone can edit their own
  localStorage. That's fine for a casual daily game; there's no server.
- **Time zones:** the day changes at local midnight, when your team rerolls
  for the new day.
- **Soft reset** (A+B+Start+Select) is turned off in the daily game, so a
  losing battle can't be restarted. (If the game ever restarts mid-battle
  anyway, the site counts it as a loss.)
- **Audio** starts suspended unless it begins during a click, so the game
  resumes it on the next key press or tap. The site test checks the emulator's
  audio is running after input.
- **Browser support:** Chrome, Edge, Firefox and Safari, on desktop and
  phones. The title card has pixel fallbacks for browsers without
  container-query units, and the ROM unpacks through the vendored fflate on
  browsers without `DecompressionStream`. Verified headless with
  `pnpm compat` (Chromium + Firefox, desktop and phone layouts); Safari's
  engine needs a Mac or device to run and hasn't been executed here yet.
- The toolchain scripts (`setup.sh`, `build-rom.sh`, `fetch-vendor.sh`) support
  macOS, Linux and Windows (Git Bash or WSL2); the browser tests additionally
  need Chrome/Chromium (see `CHROME_PATH` above).

## Project layout

```
package.json                       pnpm workspace root (build/start/test scripts)
pnpm-workspace.yaml                workspace: tests/
vercel.json                        Vercel: build web/ via scripts/vercel-build.sh
patches/pokefirered-dailyred.patch   all changes to pret/pokefirered
scripts/setup.sh                   toolchain (xPack arm-none-eabi-gcc 14.2.1 + libpng)
                                   (macOS, Linux, Windows via Git Bash/WSL; setup-macos.sh is an alias)
scripts/get-pokefirered.sh           pinned upstream checkout + patch
scripts/save-patch.sh                pokefirered/ changes → patches/
scripts/start.sh                     one-command local run: setup → build → serve on localhost
scripts/build-rom.sh                 make modern → web/game/dailyred.<hash>.gba.gz + manifest.json
scripts/fetch-vendor.sh              Nostalgist, mGBA core, font, analytics, fflate (pinned, checksummed)
scripts/serve.mjs                    local static server
scripts/vercel-build.sh              Vercel build: setup → fetch → build into web/
web/                                 the website
tests/                               headless browser tests, the teams tool and the compat matrix
```

Inside `pokefirered/`, the Daily Red code is `include/dailyred.h`,
`include/constants/dailyred.h`, `src/dailyred.c` (game flow and seed),
`src/dailyred_team.c` (team generator), `src/dailyred_boss.c` (RED's team), and
`data/maps/DailyRed_Summit/` plus `data/layouts/DailyRed_Summit/` (the map).
