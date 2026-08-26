# Product scope

Ironkeep's MVP means a security-reviewable password manager, not a demo. Every
MVP item needs tests and a complete locked/unlocked/error state before a public
stable release.

## Current implementation

### Completed in 0.7.0

- Android Autofill now offers **Use strong password** only when a visible,
  enabled new-password field belongs to a verified native package or exact HTTPS
  web origin.
- One locally generated password fills every detected new/confirmation field in
  the dataset. Ironkeep does not fill current-password or identifier fields and
  never submits the form.
- Generation uses Android's CSPRNG, guarantees every enabled character class,
  enforces the existing 8–256 character limit, and honors unlocked vault
  generator settings. A locked response remains **Unlock Ironkeep** only and
  exposes no vault data or generated secret.
- The Autofill presentation shows only the action label, never the generated
  password. Generated values are not logged, copied, placed in an Intent, or
  persisted by Ironkeep before the existing explicit save/update confirmation.
- Sensitive dataset filtering is disabled so typed password prefixes cannot
  filter or reveal the suggestion value.
- Kotlin tests cover default class coverage, ambiguous-character exclusion,
  selected character classes, requested length, and invalid configurations.
- Android version metadata is `0.7.0` / version code 8; Chromium and Firefox
  manifests report `0.7.0` with no browser runtime change.

### Completed in 0.6.0

- Android Autofill responses now register password save metadata for verified
  native packages and exact HTTPS web origins even after the normal background
  grace locks the vault.
- Locked fill responses expose only **Unlock Ironkeep**. Selecting it performs
  authentication-per-use fingerprint decryption and returns exact-target
  datasets to Android; save confirmation independently authenticates when the
  vault locked before form submission.
- Save requests prefer new-password fields, reject mismatched confirmations and
  insecure/malformed targets, and read only current `AutofillValue` data.
- Android's save sheet continues into a non-exported Ironkeep confirmation
  activity using a one-shot token-only Intent. Passwords never enter the Intent
  or confirmation UI.
- The confirmation screen offers explicit **Save as new login**, one update
  action per existing exact-target account, and **Not now**. Duplicate creation
  requires a second confirmation.
- One memory-only candidate expires after two minutes and is wiped on lock,
  dismissal, success, replacement, or timeout.
- Confirmed saves reuse Login CRUD and the same serialized atomic encrypted
  persistence path as the main app. Unchanged credentials do not rewrite the
  vault.
- Tests cover field classification, HTTPS normalization, lookalike rejection,
  create/update preservation, unchanged detection, and candidate expiry wiping.
- Android version metadata is `0.6.0` / version code 7; Chromium and Firefox
  manifests report `0.6.0` with no browser runtime change.

### Completed in 0.5.0

- Chromium and Firefox content scripts detect scoped top-frame HTTPS login,
  signup, and password-change form submissions. Hidden fields, disabled fields,
  read-only fields, mismatched password confirmations, HTTP pages, and
  cross-origin frames are excluded.
- Focusing a marked new-password field offers a locally generated 20-character
  password and fills only the new/confirmation fields. Ironkeep never submits
  the form automatically and does not offer generation on HTTP pages.
- After submission, an isolated in-page prompt shows the verified exact origin
  and detected identifier without rendering the password. It provides explicit
  **Save as new login**, **Update existing login**, and **Not now** actions.
- Existing exact-origin accounts are compared in the unlocked background
  runtime. Identical credentials produce no prompt; matching identifiers suggest
  an update; multiple accounts require an explicit selection; likely duplicate
  creation requires a second confirmation.
- One pending credential per tab lives only in background memory for at most two
  minutes. It is wiped on confirmation, dismissal, timeout, cross-origin
  navigation, tab close, vault lock, worker suspension/termination, extension
  reload, or browser restart. Same-origin navigation may resume the prompt.
- Confirmed creation and updates reuse the shared Login CRUD invariants and
  atomic encrypted-vault persistence. Failed writes leave the previous vault
  intact and keep the prompt available for retry.
- Content scripts now build in a separate IIFE pass so shared capture logic
  remains source-level reusable while Chromium and Firefox manifests still load
  standalone classic scripts.
- Tests cover signup/change/login detection, malformed and insecure candidates,
  exact-origin matching, unchanged/update/create/choice decisions, metadata
  preservation, and every pending-capture lifecycle path.
- Version metadata updated to `0.5.0` across Android, shared workspaces,
  Chromium, and Firefox.

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
- Android and browser capture plus generated-password suggestions are
  implemented for scoped ordinary forms, but broader hostile-site, framework,
  and lifecycle coverage remains a release gate.
- CRUD is implemented only for login items. Secure notes, cards, identities,
  categories, and tags do not yet have complete CRUD UI.
- CSV import/export, onboarding, conflict UI, master-password change, and vault
  deletion are not implemented.

This remains a pre-audit build. Placeholder controls and incomplete flows must
not be represented as production-ready.

## MVP — required before 1.0

### Onboarding and device setup

- Android onboarding must verify that Ironkeep is the selected Autofill service
  and open the system provider picker when it is not.
- Add an optional Android battery-usage page to onboarding. Explain why allowing
  unrestricted background use can improve Autofill availability, then ask
  whether the user wants to configure it. **Yes** opens the supported Android
  battery settings surface so the user can choose **Unrestricted**. **No** or
  **Skip** advances to the next onboarding page without changing anything.
  Ironkeep must never change the setting silently, and should fall back to its
  app-details screen when a direct per-app battery page is unavailable.
- Do not request a direct Doze exemption unless hardware testing proves that
  normal Autofill operation cannot work without it and the release satisfies
  Google Play's restricted exemption policy.

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
  exact origin rules, top-frame policy, keyboard navigation, and accessible
  overlay. The capture/save slice was completed in `0.5.0`; broader phishing and
  framework compatibility testing remains required before 1.0.
- Detect sign-up and password-change forms, offer an Ironkeep-generated password,
  and show a save-or-update prompt after the user submits or Android commits the
  autofill context. Browser support completed in `0.5.0`; Android save/update
  capture completed in `0.6.0`; Android password generation completed in
  `0.7.0`. Never save a credential without explicit confirmation.
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
