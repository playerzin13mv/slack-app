# Slack

A Discord-style chat platform: communities with text channels, real-time messaging, presence, typing indicators, user profiles and app settings.

- **Desktop** — Electron + TypeScript for Windows, macOS and Linux.
- **Mobile** — the same TypeScript UI wrapped with [Capacitor](https://capacitorjs.com) for Android and iOS.
- **Server** — Node.js + TypeScript WebSocket server, no database required (JSON-file persistence).

> The name "Slack" is a trademark of Salesforce. It's fine for a personal project, but pick a different name before publishing the apps publicly or to an app store. To rename: `name`/`productName` in `package.json`, `appId`/`productName` in `electron-builder.yml`, `appId`/`appName` in `capacitor.config.json`, and the `<title>` in `src/renderer/index.html` (the Android/iOS projects pick the name up on `npx cap sync`).

## Quick start

Requires Node.js 22+.

```bash
npm install

# Terminal 1 – the server (ws://localhost:3001)
npm run server

# Terminal 2 – the desktop app
npm start
```

Create an account on the login screen. Every new user automatically joins the **Public Square** community. Use **+** in the left rail to create your own community or join one with an invite code (the copy button next to the community name copies it).

## Features

- Communities (guilds), text channels, invite codes, unread markers, member list with online status
- **Profiles** — display name, "about me", avatar colour and password change; changes show up instantly for everyone who shares a community with you. Click any avatar, name or member to see their profile.
- **App settings** (per device) — dark / light / system theme, font size, cozy or compact messages, 12/24-hour clock, and desktop notifications for messages that arrive while the app is in the background
- Responsive layout: on phones the channel list and member list become slide-in drawers and settings open full-screen

## Project layout

```text
src/
  main/        Electron main process (window, security, IPC)
  preload/     Sandboxed bridge exposed to the renderer as window.slack
  renderer/    UI shared by desktop and mobile (plain TypeScript + CSS, bundled with esbuild)
  shared/      Wire protocol types used by both client and server
server/src/    WebSocket server and data store
android/ ios/  Capacitor native projects (generated, safe to commit)
build/         Desktop icons (icon.svg is the source of truth)
assets/        Generated source art for the mobile icons and splash screens
scripts/       Build, icon generation and launcher scripts
.github/workflows/build.yml   CI: desktop installers, Android APK, iOS IPA, server bundle
```

## Scripts

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm start`             | Build and launch the desktop app                                |
| `npm run server`        | Build and run the server                                        |
| `npm run server:dev`    | Run the server with auto-reload                                 |
| `npm run typecheck`     | Type-check main, renderer and server                            |
| `npm run icons`         | Regenerate every icon from `build/icon.svg`                     |
| `npm run icons:mobile`  | Also regenerate the Android and iOS icon/splash sets            |
| `npm run dist:win`      | Windows installer (NSIS) + portable `.exe`                      |
| `npm run dist:mac`      | macOS `.dmg` + `.zip` (Intel and Apple Silicon)                 |
| `npm run dist:linux`    | Linux `.AppImage` + `.deb`                                      |
| `npm run mobile:sync`   | Build the UI and copy it into the Android and iOS projects      |
| `npm run mobile:android`| Sync, then open the project in Android Studio                   |
| `npm run mobile:ios`    | Sync, then open the project in Xcode (macOS only)               |

Desktop installers are written to `release/`. Build each desktop target on its own OS (macOS builds need macOS); CI does this for you.

## Mobile

The renderer is the same code as the desktop app. After changing anything in `src/renderer`, run `npm run mobile:sync` to copy it into the native projects.

- **Android** — needs Android Studio (or JDK 21 + the Android SDK). Open it with `npm run mobile:android`, or build a debug APK with `cd android && ./gradlew assembleDebug`.
- **iOS** — needs a Mac with Xcode. Open it with `npm run mobile:ios`. To run on a real device or publish, set your Apple development team under *Signing & Capabilities*.

Connecting to the server from a phone:

- Enter the server as `host:port` — the app adds `ws://` for you. Use `wss://` for any server on the internet.
- **Android emulator:** `10.0.2.2:3001` (the default there). **iOS simulator:** `localhost:3001`.
- **A real phone** needs your computer's LAN address, e.g. `192.168.1.20:3001`, and the server must be reachable (allow port 3001 through the firewall).
- Plain `ws://` is allowed on both platforms so you can develop against a local server. Use TLS (`wss://`) in production.

## CI

[`.github/workflows/build.yml`](.github/workflows/build.yml) runs on every push to `main`, every pull request and on demand, and uploads these workflow artifacts:

| Job     | Artifact       | Contents                                                       |
| ------- | -------------- | -------------------------------------------------------------- |
| Desktop | `slack-Linux`  | `.AppImage`, `.deb`                                            |
| Desktop | `slack-Windows`| NSIS installer and portable `.exe`                             |
| Desktop | `slack-macOS`  | `.dmg` and `.zip` (Intel + Apple Silicon)                      |
| Android | `slack-Android`| debug-signed `.apk` (installable on any device)                |
| iOS     | `slack-iOS`    | **unsigned** `.ipa`                                            |
| Server  | `slack-server` | self-contained `index.js`, run with `node`                     |

Nothing is code-signed yet:

- Windows SmartScreen and macOS Gatekeeper warn on first launch of the desktop builds.
- The Android APK is debug-signed. For Google Play you need a release keystore and an `.aab` (`./gradlew bundleRelease`).
- The iOS `.ipa` is unsigned: it must be re-signed (AltStore, Sideloadly, or your own certificate) before it installs. App Store / TestFlight needs an Apple Developer account, a signing certificate and a provisioning profile.

## Server

```bash
PORT=3001 DATA_FILE=data/slack.json npm run server
```

| Variable    | Default           | Description                                       |
| ----------- | ----------------- | ------------------------------------------------- |
| `PORT`      | `3001`            | Listening port (`GET /health` for a health check) |
| `DATA_FILE` | `data/slack.json` | JSON persistence file; set to empty for in-memory |

`npm run build:server` produces a self-contained `dist/server/index.js` that runs with just `node`. Put it behind a TLS reverse proxy and connect clients with `wss://your-host`.

Passwords are hashed with scrypt, sessions use random tokens (changing your password signs out your other devices), input is validated, and each connection is rate limited.

## Protocol

All frames are JSON objects with a `type` field. The full list of events lives in [`src/shared/protocol.ts`](src/shared/protocol.ts).

## Roadmap

Direct messages, message editing/deleting, roles and permissions, file and image uploads, voice channels (WebRTC), push notifications on mobile, a real database, auto-update and code signing.

## License

MIT
