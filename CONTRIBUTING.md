# Contributing

## Local setup

Requirements: Node 22 (see `.nvmrc`), Rust, WebView2, and optionally Android
Studio/SDK and Bun for the Baileys sidecar build.

```bash
npm ci
npm test
npm run build
```

For the complete local check, use:

```bash
npm run check
cargo test --manifest-path desktop/src-tauri/Cargo.toml
android/gradlew.bat :app:testDebugUnitTest
```

## Pull requests

- Keep changes focused; do not commit local Agent configuration, auth folders,
  databases, logs, exported backups, API keys, QR codes, or customer data.
- Update the relevant docs and tests for behavior changes.
- Clearly mark incomplete or channel-specific features as experimental.
- Before opening a pull request, run the checks above and describe any skipped
  manual WhatsApp or Android verification.
