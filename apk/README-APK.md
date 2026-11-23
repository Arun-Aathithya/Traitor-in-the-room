# Getting an Android app (APK / AAB)

The game is a PWA, so the Android app is a thin wrapper (a Trusted Web Activity) around your **hosted HTTPS site**. It has to point at a real domain with HTTPS; `localhost` and plain `http://192.168...` addresses cannot be wrapped. I could not build an APK where I wrote this (no Android SDK, no internet), so nothing here has been run end to end. These are the steps that are supposed to work.

## 0. Host it with HTTPS
Run the server on any host that supports Node and WebSockets, with HTTPS in front (the page then uses `wss://` automatically). Keep it to one server process: rooms live in memory. Set `DATA_DIR` to a folder that survives restarts (accounts, moderation and match logs go there).

## 1. Check the PWA first
Open your site in Chrome on Android. After a few seconds the menu should offer **Install app**, and Chrome DevTools > Application > Manifest should show no errors. If that works, the wrapper will too.

## 2. Easiest build: PWABuilder
1. Go to pwabuilder.com, enter your site's address, and choose **Android**.
2. Pick a package ID (for example `com.yourname.traitor`), keep the signing option that creates a new key, and download the zip.
3. **Keep the keystore and its passwords safe.** Losing them means you cannot update the app.
4. The zip contains an `.apk` (for installing directly on a phone: allow "install unknown apps") and an `.aab` (for Google Play).

## 3. Digital Asset Links (removes the browser address bar)
Without this the app opens with a visible URL bar. Get the SHA-256 fingerprint of your signing key (PWABuilder shows it, or run `keytool -list -v -keystore android.keystore`), then start the server with:

    ANDROID_PACKAGE=com.yourname.traitor
    ANDROID_SHA256=AA:BB:...:FF        (several fingerprints separated by commas)

The server then serves `/.well-known/assetlinks.json`. Check it opens in a browser. If you also publish on Google Play with Play App Signing, add the Play-signing fingerprint from the Play Console too.

## 4. Alternative: Bubblewrap (command line)
    npm i -g @bubblewrap/cli
    bubblewrap init --manifest https://YOUR-DOMAIN.example/manifest.webmanifest
    bubblewrap build
`twa-manifest.json` in this folder is a filled-in starting point: replace `YOUR-DOMAIN.example` and `CHANGEME`. Bubblewrap asks to download the JDK and Android SDK on first run.

## 5. Google Play
You need a Play developer account (one-time fee) and a privacy policy page. Because the app has free-text chat and optional accounts, answer the Play Console content and data-safety questions honestly: chat text is filtered, reports are stored, passwords are stored as hashes. Check the current Play Console rules for testing requirements on new developer accounts before you plan a launch date.

## Updating
Because the app loads your site, game updates reach players without a new APK. Only changes to the wrapper itself (icon, name, package settings) need a rebuild. Bump `appVersionCode` each time.
