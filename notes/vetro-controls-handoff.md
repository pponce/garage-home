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

Code revision: `86bcdeb45f2cd45105e34ee834cc10de5b75502f`. All 29 checks passed: 3 Python packaging checks and 26 Node checks, including 6 browser tests. The successful workflow is https://github.com/pponce/garage-home/actions/runs/42124228904 and includes the `GarageHome-manual-unsigned` widget artifact and `GarageHome-screen-checks` screenshot artifact. The packaged source was also checked against the final source locally.

Local Chromium cannot start because this execution environment denies its process-singleton socket; browser verification ran in GitHub Actions. No physical TV installation or setting change has been performed as part of this implementation.

## Next steps

`tools/install-vetro-controls.py` provides installation for the existing launcher-playground signing setup. It pins the tested widget revision above, reuses the existing Partner profile and signing helper, preserves packaged configuration, and checks all installed file hashes. A saved record prevents another installation after an uncertain response. It uses Vetro's `tools/vetro_owner.py` from revision `f1eeaa30165a98a27502fc3f7b51a77db5238117` beside the installer. Seven installer tests cover transfer mismatch, timeout verification, rerun handling, author-certificate comparison and incomplete records; all pass locally. No TV installation has been performed from this environment.

Installer correction: the initial on-device attempt stopped before transfer or installation because the file allowlist also compared ZIP directory entries. JSZip 3.10.1 emits `service/` and `vendor/` for this package; this was reproduced locally against the real widget contents. Signed-widget validation now accepts only empty expected parent-directory records, retains exact file and signature requirements, and rejects duplicates, unknown entries, symlinks and changed payloads. All 12 installer tests pass, including five added archive-validation tests. A separate JSZip repackaging check confirmed all 21 app payloads remain unchanged. The widget revision remains the same; no prior installation submission needs recovery for this attempt.

1. Use the unsigned-widget artifact from the successful workflow above, or build the recorded code revision locally with `python3 tools/build-manual.py`.
2. Sign the widget using the existing author certificate covering the target TV, then update in place. Do not uninstall to update.
3. Approve the selected controls in Vetro and follow `docs/VETRO-CONTROLS.md` on the TV.
4. Keep brightness disabled unless explicitly wanted. Device behavior, including Filmmaker Mode persistence, needs observation on the target TV.
