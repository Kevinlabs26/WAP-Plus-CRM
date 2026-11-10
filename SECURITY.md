# Security Policy

## Supported versions

Only the latest commit on the default branch is expected to receive security fixes.
This project is experimental software and does not promise production-grade security.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose messages,
phone numbers, API keys, WhatsApp credentials, or local files. Use a private
GitHub Security Advisory when available. If private reporting is not enabled,
contact the repository owner through a private channel before publishing details.

When reporting, include the affected version, operating system, reproduction
steps, impact, and a redacted log. Never attach QR codes, auth directories,
database files, exported backups, or real customer data.

## Scope notes

- On Windows, SQLite uses SQLCipher; database keys, application credentials, and Muse handoff records are protected with user-bound DPAPI. Existing plaintext Muse records migrate when read.
- Baileys authentication files and raw message/media caches still contain sensitive local session data. Protect the Windows user profile and do not share these directories.
- The Android Bridge relies on user-granted Accessibility permission and a local token.
- Baileys and WhatsApp behavior can change independently of this project.
