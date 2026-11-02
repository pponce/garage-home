# Garage Home development

This branch builds Garage Home as a manually opened Samsung Tizen app. Read README.md for build and use instructions.

- UI source: `launcher/`; identity: `GarageHome.launcher`.
- Unsigned manual build: `python3 tools/build-manual.py`. The builder needs no TV or certificate.
- Tests: `npm install`, `npx playwright install chromium`, `npm test`.
- Keep TV runtime changes compatible with Chromium 76 and the existing ES5-style code. Do not introduce a framework or bundler.
- Preserve the app name, icon, and app identity. Keep startup metadata and automatic Vetro launches absent.
- Keep Home-button routing under the TV’s existing configuration. A compatible Vetro API is optional for controls; do not replace an existing Vetro installation to build this app.
- `player/` is a separate IPTV app. Changes to manual Home behavior should not change Player.
- `tools/build-install.sh` and `launcher/build.cjs` are optional macOS signing/install tools. The manual Python builder is the portable unsigned path.
- Per-device configuration and certificates remain local and ignored. Never request passwords in chat or commit certificates, passwords, addresses, or pairing keys.
- Do not change TV system settings, install, uninstall, or debloat without authorization for that action. Existing user authorization takes precedence over a repeated confirmation request.
- Do not add backups without the user’s approval.
- Keep internal project notes in `notes/`. Public documentation describes purpose, setup, and use.

License: PolyForm Noncommercial 1.0.0; bundled components retain their own licenses.
