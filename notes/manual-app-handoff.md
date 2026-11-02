# Manual app checkpoint

Objective: package Garage Home as a selectable TV app alongside an existing Vetro installation.

Repository: `pponce/garage-home`. Branch: `feat/manual-app-mode`. Base: `7d7548f7e34a956a6c2d74ed077d94d5960556a5`.

Completed: removed boot registration, hidden self-launch, and automatic Vetro startup. Added a portable unsigned builder, package tests, browser lifecycle tests, public setup instructions, and a build workflow. Garage Player is unchanged.

Validation: both Python package tests pass; the unsigned WGT builds reproducibly. Browser checks run in GitHub Actions because Chromium downloads are blocked in the editing environment. They use remote Arrow/OK/Back keys, matching the TV UI. Check the latest Manual app workflow for the current result. No physical TV installation has been performed.

Vetro compatibility: `zerodevb/vetro:garage` at `c09e3b1fea59855814d2106e20db51e3c93679f7` has 9 unique commits and lacks 25 commits relative to `pponce/vetro:fix/launcher-home-toggle` at `09c044359a5ac538dce3ea60fa4d727cf89a701b`. It adds pairing, playlist inbox/proxy, input watch mode, and automatic Garage Home routing. It also changes Autorun Smart Hub and webview API access. Keep the existing Vetro for manual trials; selective optional integration would be separate work.

Next steps: run the Manual app workflow, sign the unsigned widget with an existing Samsung certificate, install, and verify app visibility, Back, selected-app launch, optional Vetro controls, and cold boot. Samsung's own Autorun Last App and independently configured Vetro routing remain external factors.
