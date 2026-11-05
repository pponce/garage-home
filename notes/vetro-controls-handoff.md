# Garage Home controls handoff

## Objective and decisions

Restore task management, volume/mute and sleep timer through Vetro's app-permission API. Brightness is optional and off by default. Playback controls are excluded. Keep the selectable manual app and leave Home/startup/return policy to Vetro.

## Repositories and baseline

- Implementation: `pponce/garage-home`, branch `feat/vetro-controls`, based on `feat/manual-app-mode` at `125f15373a78ec306865a61898e3fcf3c38faa60`.
- API examined: `pponce/vetro`, `main` at `f1eeaa30165a98a27502fc3f7b51a77db5238117`.
- Client and reply-reader reference: `pponce/glass-home-samsung-tv`, `main` at `30c490194f1748d523262a1ac8985fe45f735729`.

## Completed implementation

- Added scoped controls with partial approvals, no mutation retries and verified stop/brightness results.
- Added an on-demand loopback reply service; MessagePort operations remain in the widget. Replies are authenticated by the SDK. No owner token or pairing-code access is used.
- Added permission settings and remote-operated task confirmations. Brightness is excluded until explicitly enabled and requested.
- Added nonce-bound native sleep alarms, explicit cancellation, stale-alarm rejection and a cancellable countdown. Shutdown is checked again immediately before dispatch after service readiness.
- Updated packaging to include the service, libraries and a newly generated local reader key. No boot or auto-restart registration is added. Version is 1.3.0.
- Added automated permission, reply-service, timer, packaging and browser-navigation coverage. Public device checklist is in `docs/VETRO-CONTROLS.md`.

## Validation and limitations

Unit and packaging checks run locally. Local Chromium cannot start because this execution environment denies its process-singleton socket; browser verification runs in GitHub Actions. Record the final workflow outcome before installing. No physical TV installation or setting change has been performed as part of this implementation.

## Next steps

1. Require the feature branch's Manual app workflow to pass and inspect its unsigned-widget artifact.
2. Sign the widget using the existing author certificate covering the target TV, then update in place. Do not uninstall to update.
3. Approve the selected controls in Vetro and follow `docs/VETRO-CONTROLS.md` on the TV.
4. Keep brightness disabled unless explicitly wanted. Device behavior, including Filmmaker Mode persistence, needs observation on the target TV.
