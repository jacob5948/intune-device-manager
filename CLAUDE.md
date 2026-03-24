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
  - `src/components/` — React components (DeviceItem)
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
- Client secrets stored in OS keychain (macOS Keychain / Windows Credential Manager)
- Groups collapsed by default, bulk actions require double confirmation for >100 devices
- Bulk destructive actions (e.g. delete) must require the user to type a confirmation phrase: "I really want to delete <n> devices" where <n> is the number of selected devices. Use a modal with a text input, not a native confirm dialog. The delete button must stay disabled until the phrase matches exactly. Apply this pattern to any new bulk destructive action.

## Releasing
1. Bump version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Commit the version bump
3. Tag with `git tag v<version>` and push with `git push --tags`
4. GitHub Actions builds macOS (ARM + Intel) and Windows installers, uploads stable-name assets, and creates a draft release
5. Go to GitHub Releases and publish the draft

Note: README download links use version-independent filenames (e.g. `Intune-Device-Manager_aarch64.dmg`) that the CI uploads alongside the versioned ones. No README updates needed on release.
