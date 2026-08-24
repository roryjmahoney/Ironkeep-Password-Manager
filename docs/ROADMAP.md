# Product scope

Ironkeep's MVP means a security-reviewable password manager, not a demo. Every
MVP item needs tests and a complete locked/unlocked/error state before a public
stable release.

## Present starter scaffold

- Cross-platform v1 envelope contract, schema, Argon2id/AES-GCM implementations,
  hostile-parameter limits, unit tests, and a TypeScript-to-Kotlin test vector.
- Typed models for logins, secure notes, credit cards, identities, categories,
  tags, favorites, settings, and tombstones.
- CSPRNG password generator and local password-health analysis in shared code.
- Shared React popup and MV3 background/content-script skeleton for Chromium and
  Firefox.
- Conditional Drive REST adapter for extensions; read/conditional-update adapter
  for Android.
- Android atomic storage, Keystore primitive, AutofillService skeleton, custom
  Material 3 theme, and create/unlock/home state flow.
- Build wrappers, ignore policy, documentation, and CI gates.

This is intentionally marked pre-audit. Placeholder buttons, OAuth client IDs,
biometric orchestration, CRUD screens, full importers, and conflict UI are not
misrepresented as complete.

## MVP — required before 1.0

### Vault and session

- Create/unlock/lock/change-master-password/delete-vault flows.
- Atomic encrypted persistence with crash and corruption recovery.
- Automatic lock on timeout, Android backgrounding, browser idle/worker death,
  OS/browser lock, and explicit lock.
- Working Android biometric enrollment and authentication-per-use unlock.
- Secure clipboard with configurable clearing and warnings.

### Items and organization

- Full create/read/update/delete for login, secure note, credit card, identity.
- Categories, tags, favorites, keyboard-accessible full-text search, and filters.
- Search indexes only in unlocked memory; no plaintext persistent index.
- Password generator controls for length, character classes, ambiguous/repeated
  characters, plus entropy/coverage tests.
- Health report for weak, reused, and old passwords. No secret leaves the client.

### Autofill

- Android Autofill Framework setup, unlock authentication, exact package/domain
  association, dataset selection, save prompt, and phishing-safe warnings.
- Browser username/password detection, user-selected fill, save/update prompt,
  exact origin rules, iframe policy, keyboard navigation, and accessible overlay.
- No automatic submission and no fill on insecure origins without confirmation.

### Import/export

- Import 1Password, Bitwarden, LastPass, NordPass, Chrome/Chromium CSV, Firefox
  CSV, and Ironkeep encrypted vault files.
- Preview, duplicate policy, limits, per-row errors, and one atomic commit.
- Export encrypted `.ikv` by default; optional CSV after reauthentication and an
  explicit plaintext warning.

### Drive sync

- Optional sign-in/authorization on Android, Chromium, and Firefox.
- One `appDataFolder` file, offline queue, conditional writes, duplicate-file
  stop state, replay warning, remote-deletion recovery, and manual conflict UI.
- Disconnect without deleting local data; separate explicit remote-delete action.

### Quality and release

- Light/dark/system themes, screen-reader labels, visible focus, 44–48 dp/px
  targets, reduced motion, contrast checks, localization-safe layouts.
- No analytics or plaintext crash reporting.
- Independent cryptographic/security review, parser fuzzing, autofill abuse
  tests, signed builds, SBOM, reproducibility notes, and published checksums.

## Later

- TOTP generation after secret-storage and clock-handling review.
- Passkeys/WebAuthn provider support.
- File attachments with chunked authenticated encryption and explicit Drive-size
  limits.
- Watchtower-style breach checking only with a privacy-preserving local/k-anonymity
  design and opt-in network disclosure.
- Item history and encrypted local trash retention.
- Family/shared vaults only if they can work without an Ironkeep server; this is
  research, not a promise.
- Additional desktop/browser surfaces. No iOS target.

## Explicit non-goals

- Ironkeep-hosted backend, web vault, account/password database, telemetry, or
  server-assisted recovery.
- Google password as a vault key.
- Silent conflict overwrites.
- Cloud-only operation.
- Committing release binaries to the source repository.
