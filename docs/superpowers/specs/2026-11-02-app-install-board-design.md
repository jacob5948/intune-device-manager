# App install board — design

## Intent
When an app is being upgraded across a group of laptops, the admin currently
walks to each device and checks by hand whether it has updated. The Intune
portal can't help because it doesn't organise devices the way the admin does
(laptop carts of 32, one saved list per cart in this app, each with a colour).

Add a **read-only board** that shows, at a glance, what Intune reports about one
app's install state on each device of the chosen lists, and keeps itself fresh
while the admin waits.

The board shows **what Intune reports and nothing more**. The admin still
verifies by hand; the board's job is to say "something has reported back" and
"something has failed" without clicking through devices.

## Goals
- Pick one app, pick one or more existing lists, see every device's install
  state for that app.
- Overview: each list is a block of one coloured square per device, with an
  "installed / total" count. Detail: a table under it with device name, serial,
  state, last-reported time. Clicking a list or a legend colour filters the table.
- Colours: grey = no status yet, blue = installing, green = installed,
  red = failed. Failures sort to the top of the table; failure text/code shown
  when Intune supplies it.
- Re-checks Intune on its own at a modest interval, shows "last checked", and has
  a Refresh button.
- Lives in a third header tab beside Devices and Autopilot.

## Notifications (added 2026-11-04)
- While the board is open, each refresh is compared with the last one; any device whose
  state (the four colours) changed produces one macOS notification per refresh, not one per device.
- Nothing is announced on the first report after opening the board or switching app, and a
  device that just appeared (a list ticked) is not a change.
- "Notify on changes" checkbox on the board, on by default, remembered. Uses
  `tauri-plugin-notification`; macOS asks for permission once.

## Non-goals
- ~~No notifications.~~ Changed 2026-11-04 at the user's request: a macOS notification when a
  device on the board changes state (see "Notifications" below). Still no sounds or in-app alerts.
- No verification of the actual installed version on the device.
- No deploying, assigning, retrying, syncing or any other write action. The board
  makes no write calls to Graph.
- One app at a time; no side-by-side apps.
- No history/log of past states.

## Anti-goals (a failure even if it "works")
- Showing a device as "installed" or "failed" when Intune simply has not reported
  on it. Unreported devices must be grey "no status yet", never an error.
- Any write path. A new bulk or destructive action does not belong here.
- Hammering Graph: no per-device request loops on every refresh if a per-app
  query returns all devices at once.

## Constraints and project conventions
- Access token stays in Rust; the frontend only calls Tauri commands. Add Graph
  calls to `src-tauri/src/graph.rs`, commands to `lib.rs`.
- Device and list data come from the existing `devices` and `DeviceList` state
  (`src/types/index.ts`). A list's `color` field is the cart colour; use it to label
  list blocks. Entries stored as `missing:<token>` have no device and are shown as
  `[Not found]`, not as grey squares.
- Use `Modal.tsx` for any dialog, `var(--text-secondary)` for secondary text, and
  keep dark-mode support (see CLAUDE.md). Solid blue is reserved for the open
  device and primary buttons, so the "installing" blue must be visibly distinct
  from those (builder's call).
- Graph permission needed: **`DeviceManagementApps.Read.All`** (Application).
  The feature must show a clear message when the call returns 403, naming the
  missing permission, rather than a raw error body.

## Decided with the user
- Flow: **choose the app first, then the lists.**
- Layout: a blend of "grid of squares per cart" (overview) and "table grouped by
  cart" (detail).
- Show Intune's reported state as-is; accuracy of that report is not the board's
  concern.
- Glance only; a notification on state changes was added later (see above).
- Usually one app at a time.

## Decided while building
- Endpoint: `POST reports/microsoft.graph.retrieveDeviceAppInstallationStatusReport`,
  filtered by app id and paged with `skip`/`top`. `mobileApps/{id}/deviceStatuses` and
  `getDeviceInstallStatusReport` both return "Resource not found".
- States: Installed → green; Failed and Uninstall failed → red; Install pending and
  installing → blue; everything else, including "Not applicable", → grey.
- Matching: by managed device id, falling back to a unique device name. When a device
  has several rows (one per signed-in user), the most recently reported wins.
- Refreshes every 3 minutes while the tab is open. The chosen app and lists are
  remembered between launches.
