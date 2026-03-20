# Intune Device Manager

A lightweight desktop app for managing Intune-enrolled devices without the overhead of the full Intune portal.

## Why

The Intune web portal is slow for routine device management tasks. This app gives you a fast, focused interface for the actions you actually use day-to-day — syncing devices, restarting them, and running remediation scripts — individually or in bulk.

## Quick Start

```sh
npm install
npm run tauri dev
```

On first launch, enter your Azure AD **Tenant ID**, **Client ID**, and **Client Secret**.

## Building

```sh
npm run tauri build
```

Produces a `.dmg` on macOS and `.msi`/`.exe` on Windows.

## Requirements

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) (stable)
- An Azure AD app registration with `DeviceManagementManagedDevices.ReadWrite.All` (application permission, admin-consented)

## Features

- **Device browsing** — filterable by OS, searchable by name or user, grouped by OU
- **Remote actions** — Sync, Restart, Run Remediation on Windows devices
- **Bulk actions** — select multiple devices or entire lists and act on them at once
- **Custom lists & folders** — organize devices into reorderable lists, group lists into folders
- **Import/export** — JSON, CSV, or plain-text device name lists
- **Remediation scripts** — store script IDs locally and run them on demand
- **Secure credentials** — client secret stored in macOS Keychain or Windows Credential Manager
- **Dark mode** — follows system preference

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Rust, Tauri v2 |
| API | Microsoft Graph (beta) |
| Auth | OAuth 2.0 client credentials |
