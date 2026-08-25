# Product scope

Ironkeep's MVP means a security-reviewable password manager, not a demo. Every
MVP item needs tests and a complete locked/unlocked/error state before a public
stable release.

## Current implementation

### Completed in 0.4.0

- Configurable automatic lock is enforced on Android, Chromium, and Firefox.
  The accepted inactivity range is 1–60 minutes and the default remains five
  minutes.
- Android uses a monotonic session deadline, resets it only for explicit user
  interaction, and locks after 15 seconds in the background. Automatic or
  explicit locking cancels an active biometric prompt and destroys the live
  vault session.
- Browser background runtimes own the session deadline, enforce it before every
  request, lock for browser idle/OS lock and suspension, and rely on worker
  termination to discard all unlocked state. Status polling never extends a
  session.
- Android and browser settings UI now persist auto-lock and clipboard timeouts
  through the existing atomic encrypted-vault mutation path. These changes
  increment the vault revision and retain v1 compatibility.
- Password copies from Android login editing and the browser generator route
  through an owned secure-clipboard controller. Clearing is configurable from
  15–120 seconds and occurs only when the clipboard still contains the value
  Ironkeep wrote, so newer user clipboard content is preserved.
- Chromium uses an MV3 offscreen document for clipboard access. Firefox uses
  its extension background page. Both clients declare the required clipboard
  and idle permissions; Chromium additionally declares `offscreen`.
- Shared TypeScript and Kotlin tests cover inactivity reset, background grace,
  setting limits, encrypted setting revision updates, and clipboard ownership.
- Version metadata updated to `0.4.0` across Android, shared workspaces,
  Chromium, and Firefox.

### Completed in 0.3.0

- Android biometric enrollment, unlock, and explicit disable flows are wired
  through `BiometricPrompt.CryptoObject` instead of retaining the master
  password.
- A non-exportable Android Keystore AES-256-GCM key wraps the live 32-byte vault
  data key. Every unwrap requires `BIOMETRIC_STRONG`; no authentication window
  or app-defined PIN fallback is used.
- The local convenience record is atomically stored in private app storage and
  bound with authenticated data to the vault identifier and existing key wrap.
  Login CRUD payload revisions remain compatible because they preserve that key
  wrap.
- Missing, corrupt, invalidated, or mismatched biometric material is cleared and
  falls back to the master password. Creating a replacement vault also clears
  old biometric material.
- The locked screen only offers biometric unlock after local enrollment. The
  unlocked screen exposes clear enable/disable status, confirmation, and
  success/failure feedback.
- Tests cover direct payload unlock with the retained data key, rejection of a
  wrong data key, biometric record validation, and invalidation when the vault
  key wrap changes.
- Version metadata updated to `0.3.0` across Android, shared workspaces,
  Chromium, and Firefox.

### Completed in 0.2.0

- Login create, edit, tombstone delete, and favorite toggle on Android,
  Chromium, and Firefox.
- Login fields for title, username/email/phone, password, website URIs, and
  Android package names.
- Shared mutation invariants for vault and item revisions, item timestamps,
  `updatedAt`, `writerDeviceId`, unique item identifiers, and tombstones.
- Likely-duplicate warnings based on matching identifiers, titles, exact website
  origins, and Android package names.
- Explicit destructive-delete confirmation in Android and extension UI.
- Immediate unlocked-session updates after confirmed durable writes.
- Persistence across lock, process/worker restart, and subsequent unlock.
- Payload-only v1 re-encryption using the unlocked session data key. Normal
  mutations do not retain the master password, replace the data key, or alter
  the existing key wrap.
- A fresh AES-GCM payload nonce for every save. The encrypted replacement is
  written before the session adopts the new payload, so a failed write leaves
  the previous encrypted vault and unlocked snapshot intact.
- Active-site browser account selection and fill using exact-origin matching.
  Android AutofillService matching remains limited to exact website domains or
  explicitly stored Android package names.
- A deterministic TypeScript-produced login-mutation vector that Kotlin and
  TypeScript both decrypt as the same revision-8 v1 payload.
- Tests covering add/edit/delete persistence, revision and timestamp changes,
  fresh nonces, tombstones, failed writes, lock/restart/unlock persistence, and
  Android/TypeScript compatibility.
- Version metadata updated to `0.2.0` for the root workspace, shared packages,
  Chromium and Firefox manifests, and Android app.

### Earlier scaffold

- Cross-platform v1 envelope contract, schema, Argon2id/AES-GCM implementations,
  hostile-parameter limits, unit tests, and a TypeScript-to-Kotlin test vector.
- Typed models for logins, secure notes, credit cards, identities, categories,
  tags, favorites, settings, and tombstones.
- CSPRNG password generator and local password-health analysis in shared code.
- Shared React popup and MV3 background/content-script foundation for Chromium
  and Firefox.
- Conditional Drive REST adapter for extensions; read/conditional-update adapter
  for Android.
- Android atomic storage, Keystore primitive, AutofillService skeleton, custom
  Material 3 theme, and create/unlock/home state flow.
- Build wrappers, ignore policy, documentation, and CI gates.

### Known incomplete or placeholder behavior

- Google Drive buttons and OAuth client configuration remain placeholders.
- Android `AutofillService.onSaveRequest` remains a no-op. Browser automatic
  login capture and save/update prompts are not implemented.
- CRUD is implemented only for login items. Secure notes, cards, identities,
  categories, and tags do not yet have complete CRUD UI.
- CSV import/export, onboarding, conflict UI, master-password change, and vault
  deletion are not implemented.

This remains a pre-audit build. Placeholder controls and incomplete flows must
not be represented as production-ready.

## MVP — required before 1.0

### Vault and session

- Create/unlock/lock/change-master-password/delete-vault flows.
- Atomic encrypted persistence with crash and corruption recovery.
- Automatic lock on timeout, Android backgrounding, browser idle/worker death,
  OS/browser lock, and explicit lock. Completed in `0.4.0`; lifecycle testing
  on additional Android and browser versions remains a release gate.
- Working Android biometric enrollment and authentication-per-use unlock.
  Completed in `0.3.0`; hardware-device coverage remains a release gate.
- Secure clipboard with configurable clearing and warnings. Completed in
  `0.4.0`; clipboard-manager history remains outside Ironkeep's control.

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
- Detect sign-up and password-change forms, offer an Ironkeep-generated password,
  and show a save-or-update prompt after the user submits or Android commits the
  autofill context. Never save a credential without explicit confirmation.
- Detect login forms and offer only entries associated with the verified exact
  website origin or Android application. When the user selects an entry, fill
  every recognized identifier field (username, email address, or phone number)
  and its password, but never submit the form automatically.
- If several accounts match, show an account chooser without exposing passwords.
  Do not silently choose the most recent account or overwrite another account.
- After submission with credentials that do not match the selected or stored
  entry, prompt with explicit **Save as new login**, **Update existing login**,
  and **Not now** actions. Default toward a new item for a different identifier;
  suggest updating when the identifier matches and only the password changed.
- Browser capture uses scoped content-script form events; Android capture uses
  `AutofillService` save metadata and `onSaveRequest`. Ironkeep must not install
  global keyboard hooks, act as an input method, use an Accessibility Service to
  observe typing, retain keystroke history, or log field values.
- Keep candidate credentials only in short-lived memory until confirmation.
  The confirmation screen shows the username, exact site origin or Android
  package, proposed title, and whether Ironkeep will create or update an item.
- Suggest human-readable names from the verified website hostname or installed
  application label. Use the current site's declared icon, the installed app's
  local icon, or a reviewed bundled icon catalog; never contact an Ironkeep or
  third-party logo server and never trust an icon to establish identity.
- Handle multiple accounts and duplicate matches explicitly. Successful form
  submission is a prompt signal, not proof that authentication or registration
  succeeded, and must never trigger silent storage.
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
