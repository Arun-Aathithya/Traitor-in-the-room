# Windows installer

The installer packs the game server and the game into one Electron app. After installing, double-click **Traitor in the Room** on the desktop or Start menu: the game opens in its own window and the server runs inside the app. Friends on the same Wi-Fi join by typing the address shown in **Game > Play with friends** into any browser (phone or PC), then the 4-letter room code.

## Build it (on Windows, needs Node.js 18+ and internet)
1. Double-click `build-windows-installer.bat` in the folder above (or run `npm install` then `npm run dist` inside `desktop`).
2. The installer appears in `desktop\dist` as `Traitor-in-the-Room-Setup-<version>.exe`. It lets the user choose the folder and adds desktop and Start menu shortcuts.
3. To try it without building an installer: `cd desktop`, `npm install`, `npm start`.

`prepare.js` copies `server.js`, `admin.js` and `public/` into `desktop/game` and keeps the version in step with the game's `package.json`, so rebuild after any game change.

## What the app does
- Starts the game server on port 8080 (or any free port if 8080 is taken) and opens `http://127.0.0.1:<port>` in a window.
- Keeps accounts, shop balances, reports, replays and logs in the user's app-data folder (**Game > Open data folder**). Uninstalling does not delete it.
- Creates the creator dashboard password on first run (**Game > Creator dashboard** shows it and opens the page).
- Optional Google sign-in: put your client ID in `google-client-id.txt` inside the data folder.
- Only one copy can run at a time.

## Things to know
- **Not built or run by me.** I wrote the files and checked the syntax, the copy step and that the copied game server starts and serves the page. I had no Windows, Electron or internet here, so the `.exe` itself is untested.
- **Windows SmartScreen** will warn about an unsigned installer ("Windows protected your PC": More info > Run anyway). Removing the warning needs a code-signing certificate, which is not set up.
- **Firewall.** The first time someone hosts, Windows asks to allow the app: choose **Private networks**.
- **Versions.** `electron` and `electron-builder` are pinned to the major versions I know; bump them in `desktop/package.json` before a public release for security fixes.
- The game still loads Google Fonts when online and falls back to system fonts offline.
