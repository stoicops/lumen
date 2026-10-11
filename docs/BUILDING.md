# Building an installable Lumen

Lumen is packaged with electron-builder. The REA engine and all other
dependencies are unpacked beside the app archive (`asarUnpack: node_modules/**`)
because REA runs as a separate Node process and cannot read files from inside
an asar.

## Prerequisites
- Node 24.11+ and `npm ci` in the project.
- Build on the OS you are targeting (electron-builder does not cross-compile
  macOS apps from other platforms).

## Commands
- `npm run pack` — unpacked build in `release/<platform>-unpacked/` (fast, for testing).
- `npm run dist:mac` — macOS `.dmg` + `.zip` (arm64 and x64).
- `npm run dist:win` — Windows `.exe` installer (NSIS).
- `npm run dist:linux` — Linux AppImage.

Artifacts land in `release/`.

## macOS signing and notarisation
An unsigned build runs but Gatekeeper will warn on first open (right-click →
Open). For a build you can distribute:
1. Join the Apple Developer Program and create a "Developer ID Application"
   certificate; install it in your login keychain.
2. Set before `npm run dist:mac`:
   - `CSC_LINK` / `CSC_KEY_PASSWORD` (or have the cert in the keychain), and
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarisation.
3. electron-builder signs and notarises automatically when those are present.

Signing happens only on your Mac; no certificate ever leaves it.

## Icon
`build/icon.svg` is the source. Provide `build/icon.png` (1024×1024) — and
`build/icon.icns` / `build/icon.ico` if you want platform-perfect icons — to
replace the default Electron icon. electron-builder picks them up automatically.
