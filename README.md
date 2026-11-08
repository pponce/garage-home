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

Output: `dist/GarageHome-manual-1.3.2-unsigned.wgt`, accompanied by `dist/SHA256SUMS`.

Sign the **local WGT** with your Samsung author/distributor certificate covering your TV, then install it with a compatible Tizen installer. Apps2Samsung can sign a selected local WGT using an existing certificate. For an update, reuse the installed app's author certificate and install over it to retain its data. The builder does not read certificates or modify per-device configuration files. It generates a new package-local reply-reader key for each build; this is not a Vetro owner credential.

For a phone QR link, the optional `--tv-ip TV_IP` argument supplies a fallback address. The app normally discovers the TV’s address itself.

The **Manual app** GitHub Actions workflow tests and builds the `GarageHome-manual-unsigned` artifact.

## Use

Open Garage Home from **Apps**, or pin its tile to Samsung Home. Choose a tile to open an app. From the main dashboard, press Back twice to leave; from another view, Back first returns to the dashboard. The Home button follows the TV’s existing configuration.

App browsing and ordinary app launches use Samsung’s Tizen APIs. The sleep timer is activated only when you select it; that feature can reopen the app at the requested time to present its shutdown countdown.

Choose **Sources** in the top bar or TV row to open Garage Home's input list. It shows the HDMI and Live TV inputs reported by the TV, marks the selected input and distinguishes connected devices from disconnected ports. A device in standby may appear disconnected; its port can still be selected. Opening or refreshing the list does not switch inputs.

Selecting a source changes the input through Samsung's public TVWindow API, then requests the Samsung TV viewer for full-screen video. This feature uses the widget's `tv.window` privilege and requires no Vetro app permission or Samsung network-remote pairing. If the TV accepts the input but refuses the viewer launch, Garage Home explains that result so you can open Live TV from Samsung Home. An input change with an uncertain result is not automatically repeated.

## Optional Vetro features

The quick controls use stock Vetro 0.5.0 through Garage Home's local service. Open Vetro and connect root, then choose **Vetro controls → Connect to Vetro**. No separate per-app approval or Vetro owner token is required.

| Control | Behavior |
| --- | --- |
| Running apps | Shows enabled, visible, removable user apps and their reported memory use. |
| Close app | Asks before closing an eligible app; success requires Vetro's verified result. |
| Mute and volume | Sends the selected TV audio key once. |
| Sleep timer | Schedules 15, 30, 60 or 90 minutes, then presents a 15-second Keep watching countdown before requesting standby. |
| Dimmer and Brighter | Available after explicit opt-in; reads confirmed panel-brightness support and uses expected-value writes with verification. |

**TV brightness controls are off by default.** Enabling them only adds the buttons. Using them changes a TV picture setting and can affect later viewing, including Filmmaker Mode. Turning the controls off does not restore an earlier value.

**Keep watching**, Back, leaving during the countdown, or **Vetro controls → Cancel sleep timer** cancels the pending shutdown. An unconfirmed command is never automatically repeated. Native Sources continues to use Tizen's TVWindow API.

The local service accepts only fixed controls from its authenticated local widget channel. It binds outgoing requests to the TV's own address, accepts no arbitrary destination or command, and does not start Vetro. Ordinary app browsing and launching use Tizen.

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
