# Garage Home Sources handoff

## Objective

Replace the Sources remote-key shortcut with an input list inside Garage Home. Use the native public Tizen APIs to switch the selected HDMI or TV input and request the full-screen TV viewer. Preserve the manual app, scoped controls, optional brightness and exclusion of playback buttons.

## Repository and baseline

- Repository: `pponce/garage-home`, branch `feat/vetro-controls`.
- Baseline: `c13d3a958bb8c72a408e5424136dca0c7f6526c6`.
- Glass Home reference: `app/js/platform.js` at `30c490194f1748d523262a1ac8985fe45f735729`.
- Samsung API reference: https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvwindow-api.html

## Implementation

- Version 1.3.1 adds `tv-sources.js` and the public `tv.window` privilege.
- Sources reads native `VIDEOSOURCE` data only when opened or refreshed, lists HDMI and TV inputs, retains disconnected ports, and marks the selected input.
- Selecting rechecks the input list, sends one `setSource` request and checks the reported selection before requesting `org.tizen.tv-viewer`. An explicit viewer-launch refusal may use the public app-control launch; ambiguous timeouts are not retried.
- Back or backgrounding cancels undispatched work and prevents a late viewer launch. A native input change already submitted cannot be recalled.
- The network Source-key path and its WebSocket permission are removed. No Vetro permission expansion is used.

## Validation and next steps

- Source revision: `e69b9deba26dda10bd25e8e2fe2ceececb0589ab`.
- All 59 tests and the unsigned 1.3.1 widget build passed in [CI run 42131157246](https://github.com/pponce/garage-home/actions/runs/42131157246).
- The new unit suite covers native listing, fresh selection, disconnected ports, changed reports, cancellation, duplicate presses, readback and viewer failures. Browser tests exercise the Sources tile with remote keys, error recovery, cancellation and screen margins.
- The installer pins that tested source revision, expects all 22 payload files and retains the validated signing/ZIP checks. Its added package-coverage test brings the Python suite to 16 passing tests.
- The installer reuses the saved author certificate and configuration, updates in place and verifies installed file hashes. It does not change Vetro or Developer Mode settings. An ambiguous install result is verified without repeating the installation.
- Next: run the signed update, then follow the Sources checklist in `docs/VETRO-CONTROLS.md`. Confirm the actual connected/disconnected port list, full-screen HDMI video/audio, Live TV, Back and current-input marker. Physical full-screen behavior is not yet verified.
- After the update, request and approve Garage Home's Vetro control permissions again. Sources itself needs no Vetro permission. Brightness remains optional and no playback buttons are added.
