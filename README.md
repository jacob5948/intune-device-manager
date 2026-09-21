# Intune Device Manager

A lightweight desktop app for managing Intune-enrolled devices without the overhead of the full Intune portal.

## Download

> **[Latest Release](https://github.com/jacob5948/intune-device-manager/releases/latest)**

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [`.dmg`](https://github.com/jacob5948/intune-device-manager/releases/latest/download/Intune-Device-Manager_aarch64.dmg) |
| macOS (Intel) | [`.dmg`](https://github.com/jacob5948/intune-device-manager/releases/latest/download/Intune-Device-Manager_x64.dmg) |
| Windows | [`.msi`](https://github.com/jacob5948/intune-device-manager/releases/latest/download/Intune-Device-Manager_x64-setup.msi) · [`.exe`](https://github.com/jacob5948/intune-device-manager/releases/latest/download/Intune-Device-Manager_x64-setup.exe) |

The macOS builds are signed with an Apple Developer ID certificate and notarized by Apple,
so they open normally on both Apple Silicon and Intel.

Releases up to and including **v0.2.0** were unsigned. On Apple Silicon macOS reports those
as *"damaged and can't be opened"* — download a newer release, or clear the quarantine flag
on the old one:

```bash
xattr -dr com.apple.quarantine "/Applications/Intune Device Manager.app"
```

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
- **CSV export** — export the selected devices with your choice of columns (OS, last sync, serial, compliance, …)
- **Remediation scripts** — store script IDs locally and run them on demand
- **Secure credentials** — client secret stored in macOS Keychain or Windows Credential Manager
- **In-app updates** — checks GitHub Releases on launch and installs signed updates on request
- **Dark mode** — follows system preference

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Rust, Tauri v2 |
| API | Microsoft Graph (beta) |
| Auth | OAuth 2.0 client credentials |
