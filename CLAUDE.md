# Intune Device Manager

Tauri v2 desktop app for Microsoft Intune device management via MS Graph API.

## Stack
- **Frontend:** React 19 + TypeScript, Vite
- **Backend:** Rust (Tauri v2)
- **API:** MS Graph API (beta endpoint) with client credentials OAuth2
- **Icons:** MDI (@mdi/js + @mdi/react)

## Project Structure
- `src/` — React frontend
  - `src/App.tsx` — Main application component
  - `src/App.css` — All styles (dark mode via prefers-color-scheme)
  - `src/components/` — React components (DeviceItem, ImportModal, ExportModal, AutopilotView, UpdateBanner)
  - `src/hooks/` — localStorage helpers
  - `src/types/` — Shared TypeScript interfaces
  - `src/utils/` — Pure utility functions
- `src-tauri/` — Rust backend
  - `src-tauri/src/graph.rs` — Graph API client, auth, retry logic, error types
  - `src-tauri/src/lib.rs` — Tauri commands, state management, keychain

## Build
```bash
npm install
npm run tauri dev     # development
npm run tauri build   # production
```

## Key Patterns
- Access token never touches the frontend — managed entirely in Rust state
- Token auto-refreshes with 5-minute early expiry buffer
- Graph API requests use exponential backoff retry (3 attempts, respects Retry-After)
- Device IDs are validated server-side before use in API URLs
- Custom device lists and folders stored in localStorage
- In-app updates use `tauri-plugin-updater` against `latest.json` on the newest published GitHub release; `src/hooks/useAppUpdate.ts` owns the state machine and `UpdateBanner` the UI
- All import and export goes through two dialogs — `src/components/ImportModal.tsx` and `src/components/ExportModal.tsx`. Add a new entry point by opening one of those with a pre-set scope, never by writing another bespoke handler
- The format helpers are pure and live in `src/utils/`: `importSource.ts` (decides what pasted or file text *is*, by content — never by file extension), `listFile.ts` (saved-list JSON, both directions), `exportPayload.ts` (scope + format → the exact bytes, filename and caveat), plus `csv.ts` and `device.ts`. Being pure, they can be exercised with a throwaway esbuild + node harness, which is the only testing this repo has
- CSV export columns are defined once in `src/utils/csv.ts` (`CSV_COLUMNS`); add a column there and it appears in the picker. The last selection is remembered in localStorage
- Saved-list files are a **bare JSON array** with `version: 2` on each list, not a `{version, lists}` envelope — so a file written today still imports into an older installed build. v2 entries resolve by device name, then serial, then the stored id; v1 (un-versioned) files stay **id-first**, because they always wrote a `name` — often the literal "Unknown" — and matching on it first would silently change how existing files import
- A list entry that matched nothing is stored as `missing:<token>` and renders as a `[Not found]` row. It is re-resolved through `matchIdentifiers` whenever devices refresh, so it heals by name *or* serial. Keep the 8-character `substring(8)` offset in step with the prefix
- Writing files is limited by the Tauri fs scope to `$DOCUMENT`, `$DOWNLOAD` and `$DESKTOP`; the export dialog defaults into Downloads and offers Copy as the way out
- Clipboard writes go through `src/utils/clipboard.ts`, which uses `tauri-plugin-clipboard-manager` and falls back to `navigator.clipboard`. Do not call `navigator.clipboard` directly — a macOS release build serves the webview from `tauri://localhost`, where it is not dependably available, so a browser-only call works in `tauri dev` and fails for real users
- Autopilot hardware-hash import (`AutopilotView.tsx`) is deliberately separate: it POSTs hashes to Graph to create Autopilot records, and shares nothing with device import
- Client secrets stored in OS keychain (macOS Keychain / Windows Credential Manager)
- Groups collapsed by default, bulk actions require double confirmation for >100 devices
- Bulk destructive actions (e.g. delete) must require the user to type a confirmation phrase: "I really want to delete <n> devices" where <n> is the number of selected devices. Use a modal with a text input, not a native confirm dialog. The delete button must stay disabled until the phrase matches exactly. Apply this pattern to any new bulk destructive action.

## Releasing
1. Bump version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Commit the version bump
3. Tag with `git tag v<version>` and push with `git push --tags`
4. GitHub Actions builds macOS (ARM + Intel) and Windows installers, uploads stable-name assets, and creates a draft release
5. Go to GitHub Releases and publish the draft

Updater bundles are signed with a minisign key held in the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets — separate from the Apple identity, and
unrecoverable: without it, installed copies can never auto-update again. The matching public
key is in `tauri.conf.json`. Because the updater reads `latest.json` from the newest
**published** release, a draft ships to nobody until it is published.

Only a `v*` tag push publishes a release. A manual `workflow_dispatch` run builds the
installers and attaches them as workflow artifacts instead — it must never create a tag
or a release (a `tagName` of `github.ref_name` on a dispatch run is what created the
stray `main` tag and release that had to be cleaned up).

The macOS builds are signed with a Developer ID certificate and notarized by Apple in CI.
The certificate expires **1 February 2027** — see `docs/macos-signing.md` for the secrets,
the renewal runbook, and the gotchas that cost a build each.

Note: README download links use version-independent filenames (e.g. `Intune-Device-Manager_aarch64.dmg`) that the CI uploads alongside the versioned ones. No README updates needed on release.
