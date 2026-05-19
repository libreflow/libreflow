# Security Policy — LibreFlow

LibreFlow takes the security of its users seriously. This document describes how to report vulnerabilities, what we consider in scope, and our response commitments.

## Supported versions

Only the latest release on the `master` branch receives security fixes. Older versions are not patched — please upgrade.

| Version | Supported |
|---|---|
| ≥ 1.1.0 | ✅ |
| < 1.1.0 | ❌ |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security findings.** Instead, use one of the private channels below:

1. **GitHub Security Advisories** — preferred: https://github.com/libreflow/libreflow/security/advisories/new
2. **Email** — `libreflow.app@gmail.com` with subject `[SECURITY]`. If you want PGP, request the key in your first message.

When reporting, please include:
- Affected component (Rust backend, frontend JS, build chain, updater…)
- Affected version (`Settings → System → About`)
- Steps to reproduce, ideally with a minimal proof of concept
- Suggested severity and impact (CVSS optional but appreciated)
- Whether you would like attribution in the eventual advisory

## Response timeline (Coordinated Vulnerability Disclosure)

| Step | Target |
|---|---|
| Acknowledgement of report | **≤ 5 business days** |
| Initial triage + severity | ≤ 10 business days |
| Fix released (high/critical) | ≤ 30 days |
| Fix released (medium/low) | ≤ 90 days |
| Public advisory | After patched release is widely available |

We will keep you informed at each step.

## Scope

In scope:
- Code in this repository (Rust backend, JS frontend, build scripts, CI workflows).
- Distributed binaries (`.msi`, `.exe`, future `.dmg`/`.AppImage`) signed and published from the `libreflow/libreflow` repository.
- The updater channel (`github.com/libreflow/libreflow/releases`) and its signing key.

Out of scope (please report directly to the upstream vendor):
- Vulnerabilities in third-party dependencies (`tauri`, `lofty`, `rayon`, …) unless we use them in a vulnerable way. Use [`cargo audit`](https://github.com/RustSec/rustsec) / `npm audit`.
- Vulnerabilities in the user's operating system, browser, or webview runtime.
- Issues requiring physical access to an unlocked device.
- Self-XSS that requires the user to paste attacker-controlled code into devtools.

## Threat model assumptions

LibreFlow assumes:
- The user's OS account is the security boundary; LibreFlow does not protect against an attacker with already-elevated local access on the same user account.
- The file system is trusted: paths visible to the user's account can be read/written.
- The updater channel is the only outbound connection. Its integrity is enforced by Ed25519 minisign signatures on the release manifest and the downloaded archive.
- The CSP (`default-src 'none'`, no `unsafe-eval`, no third-party origins) is the last line of defense if an injection bug ever lands.

## Disclosure preferences

- We follow **coordinated disclosure** (CVD): we work with the reporter to release a fix and a public advisory together.
- We are happy to credit reporters in advisories and release notes (with their permission and preferred name/handle).
- We do not currently run a bug bounty program; rewards may be offered at the maintainers' discretion for high-impact reports.

## Hall of fame

_Researchers who responsibly disclosed vulnerabilities will be listed here once advisories are public._
