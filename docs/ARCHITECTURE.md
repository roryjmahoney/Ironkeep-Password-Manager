# Architecture

## Fixed platform decisions

Ironkeep is Android-only plus browser extensions. The Android client is Kotlin,
Jetpack Compose, and Material 3. Both browser packages are TypeScript, React,
Tailwind CSS, Manifest V3, and `webextension-polyfill`. There is no Ironkeep
server, web application, iOS client, telemetry service, account database, or
recovery service.

The encrypted vault is authoritative. Google Drive is an optional transport and
identity boundary, not a cryptographic trust boundary. A local-only vault and a
Drive-synced vault use the same file format.

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
