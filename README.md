# Intune Device Manager

A desktop application for managing Microsoft Intune-enrolled devices via the Microsoft Graph API. Built with Tauri v2, it provides a fast, native experience for IT administrators who need to view device inventory and perform remote actions without navigating the full Intune portal.

## Overview

Intune Device Manager connects to your Azure AD tenant using app registration credentials (client credentials flow) and pulls your complete managed device inventory from the Graph API. Devices are displayed in a browsable, searchable list with per-device details and remote action support.

## Features

### Device Inventory
- Fetches all managed devices from Microsoft Intune via the MS Graph API (beta endpoint)
- Displays device name, assigned user, OS and version, compliance state, last sync time, and management state
- Devices are automatically grouped by Organizational Unit (OU) extracted from the device name
- OS tabs filter the view to All, Windows, macOS, iOS, Android, or Linux devices
- Search by device name or user principal name; supports comma-separated terms to match multiple devices at once

### Remote Actions (Windows)
- **Sync** — triggers an Intune policy sync on the selected device
- **Restart** — initiates a remote restart
- **Run Remediation** — runs a configured Intune remediation script on the device

### Bulk Actions
- Select multiple devices using checkboxes and apply Sync, Restart, or Remediation to all of them at once
- Operations exceeding 100 devices require a second confirmation to prevent accidental large-scale changes
- Progress is shown inline with a live counter during bulk operations

### Custom Device Lists
- Create named lists to bookmark any subset of devices
- Add devices to a list from the current selection, or manually via the sidebar
- Lists show device counts and warn when a device in the list is no longer found in Intune
- Remove individual devices from a list or delete the whole list
- Reorder lists using up/down controls in reorder mode
- Right-click a list to sync, restart, or remediate all Windows devices in it at once

### Folders
- Organize lists into collapsible folders
- Rename and delete folders; lists are moved to root when a folder is deleted

### Import / Export
- **Export** all lists or a single list to a JSON file
- **Import** from JSON (single list or array of lists) or from a plain-text or CSV file of device names
- Unmatched device names are preserved as placeholders in the imported list and flagged with a warning badge

### Remediation Scripts
- Configure remediation scripts in Settings by entering the Intune policy ID and a display name
- Scripts are stored locally and available for single-device or bulk execution

### Security
- Client secret is never stored in the frontend — managed entirely in the Rust backend
- Option to save the client secret in the OS keychain (macOS Keychain / Windows Credential Manager)
- Access tokens are cached in memory and automatically refreshed with a 5-minute early-expiry buffer
- Device IDs are validated server-side before use in API URLs
- Graph API requests use exponential backoff retry (3 attempts, respects `Retry-After` headers)

### UI
- Dark mode supported automatically via `prefers-color-scheme`
- Tenant ID and Client ID are persisted in `localStorage` for convenience on restart

## Prerequisites

- An Azure AD app registration with the following Microsoft Graph **application** permission: `DeviceManagementManagedDevices.ReadWrite.All`
- Admin consent granted for the permission in your tenant

## Getting Started

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   npm run tauri dev
   ```

3. Build a production binary:

   ```bash
   npm run tauri build
   ```

4. On first launch, enter your **Tenant ID**, **Client ID**, and **Client Secret** from your Azure AD app registration. Check "Save secret in keychain" to avoid re-entering it each time.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Rust, Tauri v2 |
| API | Microsoft Graph API (beta) |
| Auth | OAuth 2.0 client credentials |
| Icons | MDI (`@mdi/js` + `@mdi/react`) |
