# Architecture

## Fixed platform decisions

Ironkeep is Android-only plus browser extensions. The Android client is Kotlin,
Jetpack Compose, and Material 3. Both browser packages are TypeScript, React,
Tailwind CSS, Manifest V3, and `webextension-polyfill`. There is no Ironkeep
server, web application, iOS client, telemetry service, account database, or
recovery service.

The encrypted vault is authoritative. Google Drive is an optional transport and
identity boundary, not a cryptographic trust boundary. Google Sign-In provides
account-like vault discovery across devices, but no Ironkeep account exists and
Google credentials never unlock the vault. A local-only vault and a Drive-synced
vault use the same file format.

## System boundaries

```text
master password
      │ local Argon2id
      ▼
key-encryption key ──AES-GCM unwrap──► random 256-bit vault data key
                                            │
                                            ├─AES-GCM──► vault payload
                                            └─local-only biometric wrap on Android

encrypted .ikv bytes
      ├─► Android private app storage
      ├─► extension storage.local
      └─► optional Drive appDataFolder / ironkeep-vault.ikv
```

Only an unlocked client holds plaintext. Google receives the encrypted envelope
verbatim. Google Sign-In identifies which Drive to use; it does not derive,
escrow, reset, or replace the master password.

## Components

### `shared/`

- `src/models.ts`: versioned vault contract and all item types.
- `src/crypto.ts`: Argon2id, AES-256-GCM envelope, validation, and memory wiping.
- `src/generator.ts`: rejection-sampled CSPRNG password generation.
- `src/health.ts`: local weak/reused/old-password findings.
- `src/session-security.ts`: shared setting limits, session-deadline behavior,
  and clipboard ownership comparison.
- `schemas/`: language-neutral JSON validation contract.
- `test-vectors/`: fixed cross-language decryption vectors.
- `extension-ui/`: shared React UI, extension runtime, autofill messages, and
  Drive REST adapter used by both browser targets.

Android deliberately does not run JavaScript cryptography in a WebView. It has
an auditable Kotlin implementation of the same file contract and consumes the
same vectors. This is the safe form of reuse across JVM and browser runtimes:
one format, one algorithm specification, one schema, one vector suite.

### Android

- Compose presentation and custom Material 3 theme.
- `VaultCrypto`: Kotlin Argon2id/AES-GCM implementation.
- `VaultFileStore`: atomic private-storage reads and writes.
- `VaultSessionHolder`: one in-process unlocked session; cleared on lock.
- `BiometricKeyStore`: authentication-per-use Android Keystore key.
- `IronkeepAutofillService`: explicit package/domain matching through Android's
  Autofill Framework.
- `GoogleDriveRemote`: Drive `appDataFolder` read and conditional update layer.

The app process never treats Google authentication as vault unlock. On process
death, the unlocked session is gone and the user unlocks again.

### Browser extensions

Chromium and Firefox have separate manifests and build outputs but import the
same React UI and runtime. The MV3 background worker owns the unlocked session.
The popup sends typed messages. The content script receives only the selected
login fields required for the current origin and only after user action.

MV3 worker suspension is a security boundary: suspension discards the session.
The encrypted envelope persists in `storage.local`; a plaintext vault does not.

### Browser capture lifecycle

The shared content runtime listens only for top-frame form submission and focus
on new-password fields. Capture is limited to visible, enabled, editable fields
on HTTPS pages. Password generation and field detection share pure logic under
`shared/`; each browser compiles the content entry as a standalone classic IIFE.

The content script sends a candidate to the background with no tab or origin
authority supplied separately. The background derives both from the extension
message sender, requires frame zero and the exact HTTPS origin, and compares the
candidate only against unlocked exact-origin logins. The page prompt receives
account titles and identifiers but never the captured or stored password.

At most one pending credential exists per tab. It remains only in background
memory for two minutes and is destroyed on dismissal, successful save, timeout,
cross-origin navigation, tab close, lock, worker death, reload, or restart.
Same-origin navigation may retrieve the pending prompt. Confirmed actions flow
through the same shared login mutations and atomic encrypted persistence used by
the popup CRUD UI.

### Android capture lifecycle

The Autofill service advertises Android `SaveInfo` whenever a visible, enabled
password field belongs to a verified native package or HTTPS web origin. If the
vault has already locked, the response exposes only an **Unlock Ironkeep**
authentication action. A non-exported activity uses the existing
authentication-per-use Keystore key and `BiometricPrompt.CryptoObject`, returns
the populated response to Android, and closes the short-lived vault session.
New-password fields take precedence over current password fields, so
password-change forms save the replacement value.

After unlock, a verified target with visible new-password fields also receives
one **Use strong password** dataset. It fills only the new/confirmation fields
with one Android-CSPRNG value and never fills identifiers, current-password
fields, or submits the form. The unlocked vault supplies its encrypted generator
settings. The presentation never renders the password, and Ironkeep does not
cache, log, copy, send by Intent, or persist the generated value before confirmed
save.

After the user continues from Android's save sheet, `onSaveRequest` reads only
current `AutofillValue` data and places one candidate in process memory for at
most two minutes. A one-shot `IntentSender` contains only a random token and
opens a non-exported Ironkeep confirmation activity. The screen shows the exact
target and identifier but never the password, and requires **Save as new**,
an explicit existing-account update, or **Not now**. Duplicate creation needs a
second confirmation. Lock, dismissal, timeout, success, or replacement wipes
the candidate.

If the background grace locked the vault before submission, the confirmation
activity performs the same per-use fingerprint unlock before exposing save
choices. Its temporary session closes when the activity stops or finishes.

Confirmed Android saves share the serialized mutation coordinator used by the
main app, then reuse existing Login CRUD and atomic encrypted persistence. An
unchanged exact-target credential is discarded without a vault rewrite. HTTP
web contexts, Ironkeep's own fields, malformed targets, mismatched confirmation
passwords, and expired or cross-vault candidates fail closed.

### Session and clipboard lifecycle

Android's activity reports foreground/background transitions and user
interaction to `VaultViewModel`. The ViewModel owns one monotonic session
deadline, locks after the encrypted inactivity setting, and applies a fixed
15-second background grace. Locking is serialized with vault mutations, cancels
active biometric work, clears the owned clipboard value, and closes the session.

The extension background runtime owns the browser deadline and checks it before
handling each typed request. Popup pointer/keyboard activity sends a throttled
heartbeat; status polling does not extend the session. Browser idle/OS lock,
runtime suspension, extension reload, and worker termination all discard the
unlocked state.

Clipboard controllers retain only the expected copied value or a random Android
clip label in live memory. A timer or lock clears the clipboard only if Ironkeep
still owns it. Chromium performs this work in an offscreen document; Firefox
uses its extension background page. Clipboard managers and operating-system
history remain outside Ironkeep's control.

## Local lifecycle

### Create

1. Generate a vault UUID, device UUID, 16-byte Argon2 salt, random 32-byte data
   key, and two independent 12-byte AES-GCM nonces.
2. Derive a 32-byte key-encryption key from the exact UTF-8 master password.
3. Encrypt the data key with AES-256-GCM and authenticated header fields.
4. Encrypt the JSON payload with the data key and authenticated metadata.
5. Atomically persist the envelope. Erase transient byte arrays where the
   runtime permits.

### Unlock

1. Parse with strict size, algorithm, version, and KDF bounds.
2. Derive the key-encryption key and authenticate/decrypt the wrapped data key.
3. Authenticate/decrypt the payload.
4. Require the duplicated authenticated metadata to match the outer envelope.
5. Keep the data key and model only in the live session.

Wrong passwords, modified ciphertext, and modified authenticated headers return
the same generic authentication failure.

### Save

Every logical mutation produces a new immutable payload snapshot. Increment the
vault revision, set `updatedAt`, set `writerDeviceId`, use a fresh payload nonce,
encrypt, and replace the local file atomically. Keep tombstones for deletes so a
merge cannot resurrect removed items.

Normal mutations reuse the live session data key and the existing v1 key wrap;
they never require or retain the master password. The persisted encrypted
replacement is committed before the session publishes the new payload, so a
failed write leaves both durable and in-memory state on the previous revision.
Session setting changes use this same mutation path and do not alter the v1
envelope contract.
Browser-captured login creation and update use the same path and likewise require
no format migration.

Secure-note, payment-card, and identity mutations introduced in 0.9.0 use this
same serialized payload-only rewrite path on Android and the extensions. They
preserve the existing v1 key wrap and item creation metadata, increment item and
vault revisions, add tombstones for deletion, and publish the new unlocked
snapshot only after encrypted persistence succeeds. Search and duplicate checks
operate only on the unlocked in-memory payload and create no persistent index.

### Android biometric unlock

1. The user first unlocks with the master password and explicitly enables
   biometrics.
2. Ironkeep creates a non-exportable, authentication-per-use Android Keystore
   AES key and asks `BiometricPrompt` to authorize an encryption `CryptoObject`.
3. That cipher wraps a copy of the live vault data key. An atomic private local
   record stores only the wrapped key, nonce, and its binding to the vault
   identifier and existing password-protected key wrap.
4. A later unlock authorizes a decryption `CryptoObject`, unwraps the data key,
   and authenticates/decrypts the persisted v1 payload without the master
   password being retained.
5. Normal item saves change only payload metadata/ciphertext, so enrollment
   remains valid. A changed vault identity or key wrap, invalidated/missing
   Keystore key, corrupt record, or failed authenticated decryption clears the
   local convenience material and requires the master password.

The biometric record never enters the `.ikv` envelope or Google Drive. Android
backup and device-transfer rules exclude the vault, record, Keystore metadata,
and all other private app data.

## Optional Google Drive lifecycle

One file named `ironkeep-vault.ikv` is created in Drive's hidden
`appDataFolder`. The client requests only the `drive.appdata` scope. The
encrypted remote bytes become the cross-device source of truth; a local copy is
the offline working set.

The client stores sync metadata outside the vault: Drive file ID, last accepted
ETag/checksum, last synchronized revision, and last synchronized encrypted base
snapshot. Uploads are conditional with `If-Match`. HTTP 412 means conflict,
never permission to overwrite. Full behavior is specified in [SYNC.md](SYNC.md).

## Final repository structure

```text
Ironkeep/
├── android/
│   ├── app/src/main/java/dev/ironkeep/app/
│   │   ├── autofill/
│   │   ├── sync/
│   │   ├── ui/
│   │   └── vault/{crypto,model,session,storage}/
│   ├── gradle/wrapper/
│   └── build.gradle.kts
├── extensions/
│   ├── chromium/{public,src}/
│   └── firefox/{public,src}/
├── shared/
│   ├── extension-ui/src/{components,drive,runtime}/
│   ├── schemas/
│   ├── src/
│   └── test-vectors/
├── docs/
├── .github/workflows/
├── .gitignore
├── README.md
└── LICENSE
```

Generated `build/`, `dist/`, APK, AAB, ZIP, signing, OAuth-secret, and local SDK
files are not source. They remain ignored and are attached only to GitHub
Releases.
