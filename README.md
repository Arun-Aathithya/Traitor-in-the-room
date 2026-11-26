# Traitor in the Room

A real-time multiplayer **social-deduction game** for phones and PCs. Players join a room, complete short mini-tasks, and try to work out who the traitor is, with phone and PC players in the same match.

> Status: in active development (v0.8.0).

## Highlights
- **Cross-play rooms**: phone (installable PWA) and PC players play together in the same room
- **Signature mini-tasks** built around the game's theme: memory, lies, alibis and feel, each a few seconds long
- **Accounts and sign-in**: game accounts (salted scrypt password hashes) and Google sign-in, with a nickname and avatar for every player
- **Credits and cosmetic shop**: avatar rings and name titles, with all purchases checked on the server
- **Creator dashboard**: live stats, accounts, moderation, and a read-only match replay viewer
- **Extras**: sound and haptics, shareable result images, Windows installer and an Android (TWA) path

## Tech stack
Node.js · WebSockets (`ws`) · Vanilla JavaScript front end · PWA (service worker, web manifest) · Electron (Windows desktop build)

## Quick start
```bash
npm install
npm start          # http://localhost:8080
npm test           # runs the automated test suite
```

## Configuration
Secrets and options are read from environment variables, nothing is hardcoded:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 8080) |
| `ADMIN_TOKEN` | Turns on the creator dashboard at `/admin` (it is off without this) |
| `GOOGLE_CLIENT_ID` | Enables Google sign-in |
| `DATA_DIR` | Where accounts, rooms and match logs are stored |
| `SENTRY_DSN` | Optional error reporting |

Runtime data files (`accounts.json`, `rooms.json`, `matches.jsonl`) are git-ignored.

---

## Development notes
The sections below are the per-stage change log.

## Part 2 (v0.8.0): credits and shop, replays, match settings, image reports, Windows installer

**Match length and tasks (lobby).** The host gets a length stepper (2:00 to 7:00 in 30 s steps) and a tasks stepper (1 to 5 per player) in the lobby. Everyone sees the change at once, and the tags at the top of the lobby update. *Auto* on the length goes back to the Classic-mode default (4:00, or 3:00 in fast-and-loud). The server validates and clamps both values, only the host can change them, and they are fixed once the match starts. Keys 1 to 5 start tasks on PC. Sabotage and meeting counts still come from Classic mode.

**Credits and shop.** Signed-in accounts (game account or Google) earn credits when a match ends: 10 for finishing, +20 for a win, +3 per task (max 15), +3 per correct vote (max 6), +10 for MVP, max 80. A match with fewer than two humans, or one that ends in under a minute, pays a third, so bots cannot be farmed. Guests earn nothing. The shop (button on the home card) sells cosmetic items only: five avatar rings (120 to 200 credits) and four name titles (80 to 150). Nothing in it changes how a match plays. Prices and items live in `SHOP` in `server.js`; purchases and equipping are checked on the server. Other players see your ring and title in the lobby, roster and results. Balances are stored in `accounts.json` (`cr`, `own`, `eq`) with running totals in `eco`. The dashboard Overview shows credits held, earned and spent, and the Accounts tab shows each balance.

**Match replay (dashboard).** Every finished match is saved to `replays.jsonl` in `DATA_DIR` and appears in the dashboard **Replays** tab. The viewer is read only: a station map with a dot per player, crew task progress, a scrubber, play/pause, step, and 1x/2x/4x speed, with the event feed beside it (tasks, pairs, sabotage, repairs, meetings and who voted for whom, ejections, attacks, shield blocks, saves, eliminations, ability use). Roles are shown because the match is over. Chat is never recorded and players appear as P1, P2... (no names, account names or device ids). Positions are sampled every 6 match-seconds plus every event that moves someone. At about 8 MB the file is renamed `replays.jsonl.old`, so only the latest matches are kept. Running matches are never shown.

**Share as image.** The results screen has *Share as image* and *Share as text*. The image (1080 x 1350 PNG with the result, every role, the MVP and the timeline) is drawn on the phone with a canvas. On phones with the Web Share API for files it opens the share sheet; otherwise it saves `traitor-report.png`.

**Windows installer.** See `desktop/README-WINDOWS.md`. Run `build-windows-installer.bat` on a Windows PC with Node.js and internet to make `Traitor-in-the-Room-Setup-0.8.0.exe`. **I could not build or run it in my environment, so that part is written and syntax-checked, not run on Windows.**

**Tests.** `npm test` now also runs `test7.js` (settings clamping and live updates, task counts, credits, shop rules, replay file contents and dashboard API, CSV columns).

## Stage 2 additions (v0.7.0): signature tasks

The old wire/keypad/slider tasks are gone. Every task now uses the game's own theme: lies, alibis, memory and feel. Each task is a few seconds, works with touch or mouse, and the server still enforces a minimum time per type.

| Task | What you do |
|---|---|
| Echo the pulse | Watch, hear and feel (vibration) a 4-beat rhythm, then tap it back on the beat |
| Spot the lie | Three sums are shown and one is wrong; tap the lie |
| Afterimage | 4 of 9 cells glow briefly; tap the same 4 from memory |
| Trace the signal | Press node 1, then drag through 2 to 5 without lifting |
| Alibi check | Memorise who was at which station, then answer where one person was |
| Unscramble the alibi | Rebuild a scrambled word (TRUST, LIARS, ALIBI...) |
| Headcount | Count how many times cells flash |
| Mind trap | Tap the ink colour, not the word, three times in a row |

16 crew tasks and 8 traitor decoys use these 8 types. To add one: add a row to `CT`/`TT` and a time in `MIN` in `server.js`, then add the type to `newTask`, `xCard`, `taskAct`, `TYPEN` and `MINMS` in `public/index.html`.

## Stage 1 additions (v0.6.0)

**Run it:** Windows: double-click `start-windows.bat`. Mac/Linux: `./start.sh`. Or `npm install` then `npm start`.

**Creator dashboard login:** open `/admin`. There is **no username**. The password is the random token printed in the server window the first time you start; it is saved in `admin-token.txt` (delete that file to make a new one). Keep it private.

**Login first:** the first page is Sign in. Options: Google, game account (name + password), or Play as guest (remove the guest button in `V.login` if you want sign-in to be mandatory).

**Google sign-in:** create an OAuth Web client ID in Google Cloud Console (Credentials), add your site URL under Authorized JavaScript origins, paste the client ID into `google-client-id.txt` (or set `GOOGLE_CLIENT_ID`), restart. Needs HTTPS or localhost.

**Nickname and photo:** after login every player picks a nickname (2-12 chars) and an optional photo (resized to 64x64 on the phone). No photo: the first letter of the nickname is the avatar.

**Music and vibration:** background music (generated, no files) plus Sound, Music and Vibe toggles in the top bar. Vibration patterns fire on buttons, task success, meetings, sabotage and results (Android phones).

# Traitor in the Room - Stage 4 (PWA, icons, Android path, creator dashboard)

Stage 3 is complete too; its notes are further down.

## Run it on your PC (free)
1. Install Node.js (LTS, 22+ if you want to run the tests) from nodejs.org.
2. In this folder: `npm install` then `npm start`.
3. Open http://localhost:8080, create a room, share the 4-letter code.
4. Friends on the same Wi-Fi open http://YOUR-PC-IP:8080 (`ipconfig`). Allow Node in Windows Firewall (private networks).

## New in stage 4
**Install it (PWA).** The game has a web manifest, a service worker and icons (192, 512, maskable 512, Apple touch icon, favicon; source `public/icons/icon.svg`). On Android Chrome and desktop Chrome/Edge the home screen shows an **Install** card; on iPhone it shows the Safari "Add to Home Screen" hint. The service worker keeps the app shell, so the game opens instantly and shows its own reconnecting screen when offline. It never caches game traffic, `/admin` or `/health`, and each release uses a fresh cache. The screen stays awake during a match (where the browser allows it). Service workers and install need HTTPS, except on `localhost`.
**Android app.** See `apk/README-APK.md`. The easiest route is pwabuilder.com on your HTTPS site; `apk/twa-manifest.json` is a Bubblewrap starting point. Set `ANDROID_PACKAGE` and `ANDROID_SHA256` and the server serves `/.well-known/assetlinks.json` so the app opens without a browser bar. **I could not build an APK in my environment, so that part is documented, not run.**
**Creator dashboard.** Off until you start the server with `ADMIN_TOKEN` (pick a long random string). Open `/admin`, enter the token (kept only in that browser tab). Tabs:
- *Overview*: players online, matches played, crew vs traitor win rate, tasks finished, sabotages and meetings per match, accounts, open reports, matches per day for 14 days, how matches end, and a `matches.csv` download.
- *Reports*: every chat report and host removal with the message, room, channel and sender. Dismiss, mark reviewed, suspend the account, or suspend the device (the sender's device id is stored with each report).
- *Accounts*: stats per account (never hashes or sessions), suspend or restore.
- *Suspensions*: everything currently suspended, with restore buttons.
- *Live rooms*: counts and phase only. The dashboard never shows roles or chat from running matches.
A suspended account or device cannot sign in, create or join rooms, and is removed from its current lobby or match. Wrong tokens lock the dashboard for a minute after 5 tries. Everything players type is escaped in the dashboard.
**Data files** (in `DATA_DIR`): `matches.jsonl` (one line per match, no player names), `reports.jsonl`, `moderation.json`, `accounts.json`. Back these up. Reports contain chat text and device ids, so treat them as private.

## Tests
`npm test` also runs `test6.js` (roles and attacks, 38 checks) and `test5.js` (49 checks: manifest, real icon sizes, service worker, asset links, dashboard auth, stats, reports, suspensions, escaping). I also checked in headless Chrome that the page passes the installability check, the service worker activates, an offline reload opens the cached app, and a hostile report text does not run in the dashboard.

## Crew roles and attacks (new)
Host setting **Special roles** (on by default). With it on, every crew member gets a different role (up to six, so a full 8-player room uses all of them); the traitors get an **Attack** instead. Roles are secret until the match ends, when all of them are revealed. Turn it off for the old sabotage-only game.

| Role | What it does here |
|---|---|
| Detective | Investigate a player (3 uses, 25 s cooldown, each player once). You get a *low / moderate / high* suspicious-activity read. It is noisy on purpose: a traitor reads high 60% and moderate 40% of the time, a crew member reads low 60%, moderate 30%, high 10%. A player who was verified in a pair when every sabotage so far happened always reads low. |
| Engineer | Repairs the reactor with a 0.9 s hold instead of 2 s. Opens the maintenance panel (30 s cooldown, unlimited) to see how many players are at each station right now. |
| Guardian | Once per match, shields one player (yourself allowed). The shield absorbs the next attack on them. The attacker learns the attack was blocked, the target learns something protected them, you learn the shield held and where. |
| Scientist | Analyze a sabotage (3 uses, once per sabotage, during the alarm or up to 45 s after). You learn it came from one of two stations; one is the real one. |
| Scout | Track a player (4 uses, 20 s cooldown): their last four stations with match times. |
| Medic | If someone is attacked you are alerted with the victim and station. Hold 1.2 s to save them within the window (2 saves per match). |

**Attack (traitors).** You must be alone at your station with exactly one other living player, who must not be a traitor, and not be in a pair task. Cooldown 60 s (40 s in fast-and-loud mode), 2 attacks per match (3 in fast-and-loud). The victim is *downed* for 15 s: they cannot act or vote, only a medic can save them, and if the window runs out they are eliminated (logged in the public timeline with the station) and become a ghost who can still finish tasks. The window pauses during meetings. Attacks count towards "traitors equal the crew".
**Notebook.** Every clue and alert lands in a private notebook, with a Share button in meetings that posts the note to the meeting chat. Bots play every role too (guardian shields, medic saves about 70% of attacks, traitor bots attack when alone with one target; `BOT_SABOTAGE=0` turns bot sabotage and attacks off).
**Design choices to know about:** the game had no attack before, so Guardian and Medic needed one; it is only active with Special roles on. Role numbers live in `CLS` and `rulesFor()` in server.js. The dashboard now also shows attacks, saves and eliminations per match, and `matches.csv` has the new columns.

## Stage 3 notes (what changed since the first stage 3 build)
**Tasks.** 14 crew tasks and 10 traitor tasks across 11 types: number sequence, hold, rapid tap, dial, memory, timing, wiring, sorting, code entry, plus two mouse-only types (drag and drop, hover scan) that only PC players are dealt. Each player gets 3 tasks of different types. Traitor tasks look the same to others, do not count for the crew, and each one finished trims 8 s off the sabotage cooldown.
**Alone or pair.** Every task has two buttons. *Alone* is quick (the mini-game, with a server minimum time). *With partner* needs a second player to join and both to hold 3 s together: slower, but the timeline and meeting screen record a verified link. The starter gets the task, the helper +1 MVP.
**Meeting screen.** New card with verified pairs, and cleared suspects. A sabotage needs the traitor alone and not in a pair, so players verified in a pair at the moment of an alarm are cleared for that alarm. Players cleared for every alarm so far get a "cleared" badge next to the vote button.
**Chat.** Lobby chat; ghost chat (only players who are out see it); traitor channel (only traitors, during play); host remove (host can remove any lobby or meeting message, and remove a player from the lobby; a removed device cannot rejoin that room). Mute and Report work in all channels; ghost and traitor reports never write to the public timeline.
**Ghost tasks.** A crew player who is out keeps their unfinished tasks (alone only) and they count for the crew. Ghost bots keep working too.
**Host settings.** Max players (3-8, never below the current count). **Classic mode** now changes rules: on = 4:00 match, 2 meetings, 3 sabotages; off = "fast and loud" 3:00, 3 meetings, 4 sabotages, shorter sabotage cooldowns. (I had to pick what Classic means; the numbers live in `rulesFor()` in server.js and `rulesFor` in the client.)
**PC extras.** Keyboard shortcuts (press `?` for the list: 1-3 start a task, Shift+1-3 pair, Space hold/tap, M/Y/N meeting, S sabotage, C chat, digits in meetings to vote), hover tooltips, mouse-only tasks.
**Polish.** Ejection animation (respects reduced motion), haptic pattern on the sabotage alert, synthesised sound effects (toggle in the header, remembered), Share report on the results screen (system share sheet, or copies to the clipboard).
**Security.** Rejoin tokens rotate on every rejoin and every 10 minutes while connected (`TOKEN_ROTATE_MS`); the previous token works for `GRACE_MS` (default 30 s) so a lost reply cannot lock a player out. Optional accounts: name + password (scrypt, salted), 30-day session tokens that are stored hashed, login lockout after 5 wrong tries, stats kept in `accounts.json`. Guests still work. Use HTTPS online, because passwords cross the connection. The page is served with a content security policy.

## Tooling
- `npm test` starts its own server and runs `test.js` (stage 2), `test3.js` (stage 3), `test4.js` (this round, runs its own server and inspects room state) and a short bot load test.
- `npm run load` - bots play real matches: `PORT=8080 SPEED=10 npm start`, then `ROOMS=30 PLAYERS=6 SECONDS=60 node loadtest.js`. It prints connect time, chat round trip, state size, matches finished, memory, and fails on errors.
- **Sentry (optional):** `npm i @sentry/node`, then start with `SENTRY_DSN=... npm start`. Server errors (and browser errors, which the page forwards to the server) are reported with room code and phase only; no chat text, names, tokens or request data are sent. Without the DSN it just logs to the console. `/health` returns JSON (rooms, players, memory) for uptime monitors.

## Environment variables
`ADMIN_TOKEN`, `ANDROID_PACKAGE`, `ANDROID_SHA256`, `PORT`, `SPEED` (test clock), `DATA_DIR` (where accounts.json, reports.jsonl, rooms.json go), `GRACE_MS`, `TOKEN_ROTATE_MS`, `MAX_ROOMS`, `TRUST_PROXY` (read the client IP from x-forwarded-for behind a proxy), `SENTRY_DSN`, `SENTRY_ENV`, `BOT_SABOTAGE=0` (bots never sabotage; used by `npm test`).

## Next
Stages 1 to 4 are done. Not covered: hosting setup, a Play Store listing, and self-hosted fonts (the page still loads Google Fonts when online and falls back to system fonts offline).
