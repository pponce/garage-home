# Garage Home — manual app

A full-screen Samsung Tizen app with an app grid, weather, news, backgrounds, and optional TV controls. Open **Garage Home** from the TV’s Apps list whenever you want to use it.

This build does not register boot startup, bring itself forward when started hidden, or start Vetro. Its display name, icon, and app identity (`GarageHome.launcher`) remain intact. Samsung’s **Autorun Last App** setting can still reopen the last app independently.

![Garage Home](docs/images/garage-home-1.2.jpg)

## Build an unsigned app

Python 3.10+ is sufficient; no certificate, Node dependencies, or TV connection is needed to create the widget.

```sh
git clone --branch feat/vetro-controls git@github.com:pponce/garage-home.git
cd garage-home
python3 tools/build-manual.py
```

Output: `dist/GarageHome-manual-1.3.0-unsigned.wgt`, accompanied by `dist/SHA256SUMS`.

Sign the **local WGT** with your Samsung author/distributor certificate covering your TV, then install it with a compatible Tizen installer. Apps2Samsung can sign a selected local WGT using an existing certificate. For an update, reuse the installed app's author certificate and install over it to retain its data. The builder does not read certificates or modify per-device configuration files. It generates a new package-local reply-reader key for each build; this is not a Vetro owner credential.

For a phone QR link, the optional `--tv-ip TV_IP` argument supplies a fallback address. The app normally discovers the TV’s address itself.

The **Manual app** GitHub Actions workflow tests and builds the `GarageHome-manual-unsigned` artifact.

## Use

Open Garage Home from **Apps**, or pin its tile to Samsung Home. Choose a tile to open an app. From the main dashboard, press Back twice to leave; from another view, Back first returns to the dashboard. The Home button follows the TV’s existing configuration.

App browsing and ordinary app launches use Samsung’s Tizen APIs. The sleep timer is activated only when you select it; that feature can reopen the app at the requested time to present its shutdown countdown.

## Optional Vetro features

The quick controls use Vetro's app-permission API. A running version with native app access and authenticated HTTP replies is required. Open **Vetro controls → Connect / request access**, approve Garage Home in Vetro's **App permissions**, then choose **Refresh access** in Garage Home. Each permission can be approved separately.

| Control | Permission | Behavior |
| --- | --- | --- |
| Running apps | `tasks.read` | Shows eligible running user apps and their memory usage. System and preloaded apps are excluded by Vetro. |
| Close app | `tasks.stop` | Asks before closing one eligible app and reports success only after Vetro verifies the result. |
| Mute, Volume down, Volume up | `remote.audio` | Sends the selected TV audio key once. |
| Sleep timer | `power.off` | Schedules 15, 30, 60 or 90 minutes, then displays a 15-second **Keep watching** countdown before requesting standby. |
| Dimmer, Brighter | `picture.brightness` | Adjusts the TV's picture brightness within its reported range; available only after explicit opt-in and approval. |

**TV brightness controls are off by default.** They are absent from the initial permission request and the quick-control row. Enabling them in **Vetro controls** adds the buttons but does not change the picture. Using Dimmer or Brighter changes an actual TV picture setting and can affect subsequent viewing, including Filmmaker Mode. Turning the controls off hides them; it does not restore a previous brightness value.

Select the sleep tile repeatedly to choose a duration or turn the timer off. **Vetro controls → Cancel sleep timer** also cancels an active timer directly. The alarm can reopen Garage Home for its countdown. **Keep watching**, Back, or leaving Garage Home during the countdown cancels that shutdown. Vetro checks power permission again when standby is requested. An unconfirmed command is not automatically repeated, and an expired alarm is not replayed at a later startup.

Garage Home starts its own small reply service only when a control is used. Requests travel through Tizen's app-identified MessagePort API; the local service only retrieves replies, which the widget authenticates. Garage Home does not start Vetro, read its pairing code, or require an owner token for these controls. If access is denied or unavailable, the control reports the problem without using a privileged fallback.

Ordinary app browsing and launching continue through Tizen. Samsung-specific launch fallbacks and the phone remote depend on the APIs available in the installed Vetro version; app-control permissions do not grant unrestricted remote keys or protected Samsung shortcuts.

The Garage-specific Vetro fork also provides pairing and Garage Player’s phone playlist inbox and playlist proxy. Its independent Home/startup automation can launch Garage Home even when the widget itself has no startup registration. Keep those external assignments disabled when using Garage Home manually.

Garage Player and its tools are included separately in `player/`. The manual Home builder packages only `launcher/`.

## Test

Use Node.js 22+ and Python 3.10+:

```sh
npm install
npx playwright install chromium
npm test
```

Checks cover widget contents and startup registration, permission denial and partial approval, authenticated replies, verified app closing, brightness opt-in, sleep cancellation and replay prevention, and remote-key navigation. Browser tests simulate the Tizen APIs; physical TV behavior still needs verification. See [TV verification](docs/VETRO-CONTROLS.md) for the device checklist.

## Credits and license

Based on [Garage Home](https://github.com/zerodevb/garage-home) by The Garage Devs. See [LICENSE](LICENSE): PolyForm Noncommercial 1.0.0. Vetro and bundled libraries retain their own licenses.
