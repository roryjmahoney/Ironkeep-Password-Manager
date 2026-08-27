# Contributing to Ironkeep

Ironkeep accepts focused bug reports, documentation improvements, tests, and
code contributions. Security and privacy take priority over feature count.

Ironkeep is pre-audit alpha software. Do not use real credentials, vaults,
payment information, OAuth tokens, or signing material while testing.

## Report security issues privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting form:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/security/advisories/new>

Follow [the security reporting policy](.github/SECURITY.md). Use synthetic test
data and provide the affected version, platform, reproduction steps, expected
behavior, observed behavior, and likely impact.

## Before starting work

Search existing issues and pull requests. For a large feature, cryptographic
change, vault-format change, permission expansion, dependency migration, or
cross-platform redesign, open an issue before implementation. Describe:

- the user problem;
- the narrowest complete change that solves it;
- security and privacy implications;
- affected Android, Chromium, Firefox, and shared components; and
- how the result will be tested.

Small fixes and documentation corrections may go directly to a pull request.
Keep each contribution narrowly scoped. Avoid combining refactors, formatting,
dependency updates, and new behavior in one pull request.

## Development setup

Required tools:

- Git;
- Node.js 22 or newer;
- JDK 21 for the current CI configuration;
- Android Studio and Android SDK Platform 36 for Android work; and
- a supported Chromium or Firefox browser for extension testing.

Clone and install dependencies:

```powershell
git clone https://github.com/roryjmahoney/Ironkeep-Password-Manager.git
Set-Location '.\Ironkeep-Password-Manager'
npm ci
```

See [the Windows build guide](docs/WINDOWS_BUILD.md) for Android SDK setup,
device testing, browser-extension loading, and release details.

## Repository boundaries

- `shared/` owns the TypeScript vault model, extension-shared logic, schema,
  and cross-platform vectors.
- `android/` owns the Kotlin implementation, Compose UI, Android Autofill,
  Keystore integration, and private storage.
- `extensions/chromium/` and `extensions/firefox/` contain platform manifests
  and entry points while reusing `shared/extension-ui/`.
- `docs/` contains normative architecture, security, vault-format, sync, and
  product-scope documentation.

Android must not run JavaScript cryptography in a WebView. Cross-platform reuse
comes from one specified format, schema, and vector suite, with separate Kotlin
and TypeScript cryptographic implementations.

## Security invariants

Contributions must preserve these rules:

- No Ironkeep backend, server, web vault, analytics, or plaintext crash
  reporting.
- Never log or commit passwords, decrypted vault items, vault keys, OAuth
  tokens, signing keys, keystores, or real vault files.
- Google credentials may locate and transport one encrypted Drive vault; they
  never unlock or recover it.
- Plaintext exists only in an unlocked local session. Search indexes remain in
  memory.
- Every encrypted payload rewrite uses a fresh nonce, preserves required
  authenticated metadata, writes durable storage before publishing session
  state, and leaves the previous state authoritative on failure.
- Locked Autofill responses expose no vault data. Autofill must verify exact
  HTTPS origins or explicitly associated Android packages and must never submit
  forms automatically.
- Unconfirmed captured credentials remain short-lived memory only and require
  explicit save or update confirmation.
- Browser content scripts remain standalone classic-script IIFE bundles with
  no static or dynamic imports.
- Backups default to authenticated encrypted `.ikv` files. Never create a
  plaintext intermediary.

Read [the architecture](docs/ARCHITECTURE.md), [security model](docs/SECURITY.md),
[vault format](docs/VAULT_FORMAT.md), and [roadmap](docs/ROADMAP.md) before
changing a security boundary.

## Code and test expectations

- Match existing Kotlin and TypeScript style.
- Prefer small, testable functions and existing shared abstractions.
- Add regression tests for every bug fix.
- Add success, cancellation, invalid-input, locked, and persistence-failure
  coverage for new security-sensitive flows.
- Keep user-visible errors free of secrets.
- Update normative documentation when behavior or security boundaries change.
- Do not redesign unrelated UI in a functional pull request.
- Test Android-facing changes on physical hardware when possible and state the
  device and Android version in the pull request.

Run the JavaScript and extension gates from the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run lint
npm run build
node .\scripts\verify-extension-content-scripts.mjs
```

Run the Android gates from `android/`:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain --no-parallel
```

Use a debug APK for device testing. Release APKs built from the command line may
be unsigned and must not be published as production artifacts.

## Pull requests

A pull request should include:

- a concise statement of the problem and solution;
- linked issue or security advisory when applicable;
- security and privacy impact;
- tests added and exact commands run;
- manual verification steps and platform/device details;
- screenshots for visible UI changes without real secrets; and
- documentation or release-note changes required by the behavior.

Before requesting review:

- rebase or merge the latest target branch without discarding others' work;
- review the complete diff and `git diff --check` output;
- verify no generated files or secrets are staged;
- keep lockfile changes limited to intentional dependency changes; and
- confirm CI passes.

Reviewers may request a smaller pull request when a change crosses multiple
security boundaries or mixes unrelated work.

## Files that must not be committed

Do not commit:

- APK, AAB, APKS, CRX, XPI, or extension ZIP files;
- Android keystores, signing keys, certificates containing private keys, or
  passwords;
- OAuth client-secret JSON, service-account keys, access tokens, or refresh
  tokens;
- `android/local.properties` or machine-specific SDK paths;
- real `.ikv` vaults or plaintext password-manager exports; or
- generated `build/`, `dist/`, or dependency directories.

Use synthetic fixtures. Deterministic cryptographic test vectors must be clearly
marked as public test material and must never reuse production secrets or
nonces.

## Licensing contributions

Ironkeep is licensed under `AGPL-3.0-only`. By submitting a contribution, you
represent that you have the right to submit it and agree that it may be
distributed under the repository's AGPL-3.0-only license. Do not copy code,
fonts, icons, text, or other assets without a compatible license and required
attribution. Update `THIRD_PARTY_NOTICES.md` when required.

## Documentation and conduct

Write documentation in plain language. Describe security properties precisely;
do not claim that pre-audit software is production-ready, unbreakable, or
zero-risk.

Be specific and respectful in issues, reviews, and pull requests. Critique the
change, provide evidence, and avoid publishing another person's private data.
