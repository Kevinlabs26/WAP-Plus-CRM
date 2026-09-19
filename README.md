<table>
<tr>
<td width="140" align="center" valign="top">
<img src="desktop/src/assets/wap-plus-crm.png" alt="WAP Plus CRM icon" width="112" />
</td>
<td valign="top">
<h1>WAP Plus CRM</h1>
<p>A WhatsApp sales CRM with embedded Baileys messaging by default and an Android Bridge fallback.</p>
</td>
<td align="right" valign="top">
<strong>Support the project</strong><br /><br />
<a href="https://buymeacoffee.com/kevinlabs26"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&amp;logo=buymeacoffee&amp;logoColor=000000" alt="Buy Me a Coffee" /></a><br />
<a href="https://ko-fi.com/kevinlabs"><img src="https://img.shields.io/badge/Ko--fi-13C3FF?style=for-the-badge&amp;logo=ko-fi&amp;logoColor=ffffff" alt="Ko-fi" /></a><br />
<a href="https://kevinlabs.lemonsqueezy.com/checkout/buy/7b60b363-50b5-4233-a982-91a0611eccd6"><img src="https://img.shields.io/badge/Lemon%20Squeezy-FFC233?style=for-the-badge&amp;logo=lemonsqueezy&amp;logoColor=000000" alt="Lemon Squeezy" /></a>
</td>
</tr>
</table>

[中文文档](README.zh-CN.md)

> **Public repository notice:** This is an independent personal/community project and is not affiliated with WhatsApp. Baileys and Android Accessibility may be affected by platform rules, version changes, or account restrictions. Evaluate compliance and account risk for your own use. Do not market this project as a way to avoid bans.

WAP Plus CRM helps you manage customers, conversations, AI assistance, and sales follow-ups from your desktop. Messages are sent through the embedded Baileys channel by default, with support for a real WhatsApp Business phone through the Android Bridge. The device/channel layer is only a messaging transport; it is not the main product UI. This project does not use the WhatsApp Cloud API.

See the [requirements](docs/REQUIREMENTS.md), [architecture](docs/ARCHITECTURE.md), and [channel documentation](docs/CHANNELS.md) for more details.

## Privacy and security boundaries

- Messages, contacts, the SQLite database, and Baileys login credentials are stored locally by default. This release does not provide end-to-end cloud synchronization and does not guarantee encryption at rest for the local database.
- API keys are used only for local AI requests. When you use a third-party AI provider, the content sent to the model depends on the feature you trigger and the provider you choose. Review the provider's privacy policy first.
- Never commit `reasonix.toml`, `.reasonix/`, `baileys-auth/`, databases, logs, exports, real tokens, or API keys.
- Do not include phone numbers, chat content, QR codes, login credentials, or complete logs in public issues. For security reports, see [SECURITY.md](SECURITY.md).

## Repository layout

```text
WAP Plus CRM/
├── docs/                 # Requirements, architecture, channel, and protocol docs
│   └── protocol-plan/    # Historical protocol notes, not the current source of truth
├── shared/               # Shared protocol definitions and contract fixtures
├── desktop/              # Tauri 2 + React + TypeScript + Drizzle desktop app
│   ├── src/              # Conversation, CRM, and settings UI
│   ├── baileys-bridge/   # Embedded Baileys Node sidecar
│   └── src-tauri/        # Rust host for ADB, Bridge, and Baileys processes
├── android/              # Kotlin Android Bridge service and overlay
├── tools/                # Cross-platform development tools
├── package.json          # npm workspace configuration
├── package-lock.json     # Root dependency lockfile
├── .env.example          # Environment variable template
└── README.md
```

## Installation

Install the desktop UI and Baileys sidecar from the repository root:

```bash
npm install
```

Common commands:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite desktop UI |
| `npm run tauri -- dev` | Start the Tauri desktop shell; Rust and WebView2 are required |
| `npm run release:win` | Build the Windows Tauri installer, including the Baileys sidecar |
| `npm test` | Run desktop protocol and unit tests |
| `npm run mock-bridge` | Start the local mock Android TCP Bridge |
| `npm run baileys:build` | Build the Baileys sidecar; Bun is required |

You can also work from `desktop/` or `desktop/baileys-bridge/`. The `shared/` package is consumed through the Desktop `@shared/*` path alias. The Android project is opened in Android Studio or built with Gradle.

## Quick start

### Desktop UI

This starts the browser-based UI without requiring Rust:

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser. Browser mode cannot start the Baileys child process; use the Tauri shell for QR-code messaging.

### Full Tauri shell

Install [Rust](https://rustup.rs) and Windows WebView2, then run:

```bash
npm install
npm run tauri -- dev
```

Open **Connect WhatsApp** from Settings or the top bar and scan the QR code. For the phone-based channel, see the [Android Bridge setup guide](docs/BRIDGE_SETUP.md).

To build the Windows installer locally:

```bash
npm run release:win
```

The Baileys sidecar is generated during this command and is intentionally not committed to Git. The installer is written under `desktop/src-tauri/target/release/bundle/`.

### Desktop auto-updates

Auto-updates require the GitHub repository URL and a Tauri signing secret. See the [auto-update release guide](docs/UPDATES.md). For each release, increment the version in `desktop/src-tauri/tauri.conf.json` and push a `v*` tag; GitHub Actions generates the signed installer and `latest.json`. Publish the Draft Release before expecting installed clients to find it.

### Android Bridge

Open `android/` in Android Studio, or run:

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb forward tcp:17890 tcp:17890
```

See the [Android guide](android/README.md) for details.

## Core capabilities

1. **AI customer cards** — automatically surface identity, stage, summaries, and follow-up information.
2. **Persistent phone binding** — opening a contact can select its associated phone for the Android Bridge channel.

## Technology stack

| Area | Technology |
|---|---|
| Desktop | Tauri 2 · React · TypeScript · Tailwind · Zustand · Drizzle · SQLite |
| Default channel | Embedded Baileys via a desktop sidecar |
| Fallback channel | Android Bridge with Kotlin, Accessibility, Overlay, and ADB |
| Protocol | JSON envelopes over TCP/WebSocket/ADB |

## License

Licensed under the [Apache License 2.0](LICENSE).
