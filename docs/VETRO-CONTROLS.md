# Vetro controls: TV verification

Install the signed Garage Home widget over the existing app using the same author certificate. Open Garage Home manually. Vetro must already be running with App access enabled.

1. Open **Vetro controls → Connect / request access**. Verify that the request contains running apps, close apps, volume and power-off access. Brightness must not be requested.
2. Approve the permissions in Vetro, return to Garage Home and select **Refresh access**. Partial approvals should be shown accurately.
3. Select **Volume down**, **Volume up** and **Mute**. Confirm one operation per deliberate button press and check the TV's actual audio output.
4. Open **Running apps**. Launch an ordinary installed user app if the list is empty. Close an eligible app through its confirmation and confirm it disappears on refresh. System and preloaded apps must remain excluded.
5. Set a 15-minute sleep timer, then cancel it from **Vetro controls**. Verify no shutdown occurs at the cancelled time. Schedule a new timer and wait for the countdown; **Keep watching** and Back must cancel shutdown. Test an uncancelled countdown only when standby is wanted.
6. Revoke one approved permission in Vetro and try that control again. It should explain the denial. Reapprove it and use **Refresh access** to update the displayed status.
7. Confirm that Dimmer and Brighter are absent on a fresh installation. Enabling **TV brightness controls** should show an explanation and add buttons without changing the picture. Request and approve brightness separately if this feature is wanted.
8. Before testing Dimmer or Brighter, record the current TV brightness and picture mode. Adjust once, inspect the real picture setting and return it to the recorded value if desired. Disabling the controls must hide the buttons; it does not undo a picture adjustment.
9. Leave Garage Home, reopen it and confirm the brightness preference is retained. When no sleep timer is scheduled, hidden startup and foreground changes must not bring Garage Home forward or start Vetro.

The browser suite validates the UI and permission handling with simulated Tizen APIs. Device checks are still required for service startup, MessagePort delivery, native alarm delivery, audio routing and model-specific brightness behavior.

## Sources

1. Open **Sources** from the top bar and TV row, then from the top bar on the Apps page. Confirm each opens the same input list with the reported HDMI ports, connection labels and selected-input marker. Opening the menu must leave the current input unchanged.
2. Select a connected HDMI port. Confirm the correct source appears full-screen and verify its audio. If the TV viewer cannot open, record the message shown in Garage Home.
3. Reopen Garage Home and Sources. Confirm the selected-input marker matches the port chosen in step 2.
4. Check that Back closes the menu without switching. If a device is in standby, its reported port remains selectable even when marked **No device detected**.
5. If Live TV is reported, select it and confirm the TV viewer opens. The available signal depends on the TV's tuner setup.

Sources uses the public Tizen TVWindow API. The native input enumeration and full-screen TV viewer behavior need verification on each TV model. An app update requires a new Vetro approval for the controls that use Vetro; Sources works independently of those approvals.
