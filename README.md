# Garage Home — manual app

A full-screen Samsung Tizen app with an app grid, weather, news, backgrounds, and optional TV controls. Open **Garage Home** from the TV’s Apps list whenever you want to use it.

This build does not register boot startup, bring itself forward when started hidden, or start Vetro. Its display name, icon, and app identity (`GarageHome.launcher`) remain intact. Samsung’s **Autorun Last App** setting can still reopen the last app independently.

![Garage Home](docs/images/garage-home-1.2.jpg)

## Build an unsigned app

Python 3.10+ is sufficient; no certificate, Node dependencies, or TV connection is needed to create the widget.

```sh
git clone --branch feat/manual-app-mode git@github.com:pponce/garage-home.git
cd garage-home
python3 tools/build-manual.py
```

Output: `dist/GarageHome-manual-1.2.0-unsigned.wgt`, accompanied by `dist/SHA256SUMS`.

Sign the **local WGT** with your Samsung author/distributor certificate covering your TV, then install it with a compatible Tizen installer. Apps2Samsung can sign a selected local WGT using an existing certificate. The builder does not read certificates or modify per-device configuration files.

For a phone QR link, the optional `--tv-ip TV_IP` argument supplies a fallback address. The app normally discovers the TV’s address itself.

The **Manual app** GitHub Actions workflow tests and builds the `GarageHome-manual-unsigned` artifact.

## Use

Open Garage Home from **Apps**, or pin its tile to Samsung Home. Choose a tile to open an app. From the main dashboard, press Back twice to leave; from another view, Back first returns to the dashboard. The Home button follows the TV’s existing configuration.

App browsing and ordinary app launches use Samsung’s Tizen APIs. The sleep timer is activated only when you select it; that feature can reopen the app at the requested time to present its shutdown countdown.

## Optional Vetro features

Quick controls, brightness adjustment, system-app launching, and the task manager need a compatible running Vetro API. The API must allow requests from the TV app. These controls report an error when the service is unavailable or does not permit the request. An existing Vetro installation can remain in place; this app does not configure or replace it.

The Garage-specific Vetro fork also provides pairing and Garage Player’s phone playlist inbox and playlist proxy. Its independent Home/startup automation can launch Garage Home even when the widget itself has no startup registration. Keep those external assignments disabled when using Garage Home manually.

Garage Player and its tools are included separately in `player/`. The manual Home builder packages only `launcher/`.

## Test

Use Node.js 22+ and Python 3.10+:

```sh
npm install
npx playwright install chromium
npm test
```

Checks cover the generated widget, hidden startup, foreground changes, opening a selected app, and leaving with Back. Browser tests simulate the Tizen APIs; physical TV behavior still needs verification.

## Credits and license

Based on [Garage Home](https://github.com/zerodevb/garage-home) by The Garage Devs. See [LICENSE](LICENSE): PolyForm Noncommercial 1.0.0. Vetro and bundled libraries retain their own licenses.
