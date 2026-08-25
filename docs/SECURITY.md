# Security model

Status: pre-audit starter. Do not store real secrets until the production gates
at the end of this document are complete and independently reviewed.

## Security goals

- A copied local or Drive vault cannot be decrypted without the master password.
- Any ciphertext or authenticated-metadata modification fails closed.
- Ironkeep infrastructure cannot inspect, recover, or reset vault contents.
- Offline creation, unlock, search, editing, generation, and autofill work with
  no Google account and no network.
- A stale device cannot silently overwrite a newer Drive vault.
- A compromised web page cannot request arbitrary vault contents through the
  content script.

## Assets and adversaries

Protected assets are vault item plaintext, the vault data key, master-password
material, local biometric wrapping material, and export files. Consider:

- theft of the encrypted local database or Drive file;
- a malicious Drive reader or Google account compromise;
- network interception or replay;
- a malicious site requesting autofill on an adjacent/lookalike domain;
- extension-process inspection, a rooted Android device, malware, or a hostile
  accessibility service;
- dependency, update, or build-pipeline compromise;
- denial-of-service through malformed KDF parameters or oversized input.

## Cryptographic construction

| Element | Construction |
|---|---|
| Password KDF | Argon2id v1.3, 16-byte random salt |
| Production profile | 64 MiB, 3 iterations, parallelism 4 |
| Accepted floor | 19 MiB, 2 iterations, parallelism 1 |
| Accepted ceiling | 256 MiB, 10 iterations, parallelism 8 |
| Content key | 32 random bytes per vault |
| Encryption | AES-256-GCM, 12-byte random nonce, 128-bit tag |
| Encoding | UTF-8 JSON, unpadded base64url binary fields |

The password-derived key wraps a random data key. Payloads use the data key.
Changing the master password therefore creates a fresh salt and wrapping nonce
and rewraps the same data key without exposing/re-encrypting every item.

The accepted KDF ceiling is essential. Without it, an attacker-controlled file
could force memory or CPU exhaustion before authentication.

The defaults follow RFC 9106's memory-constrained recommended Argon2id profile;
the compatibility floor follows the OWASP Password Storage Cheat Sheet. The
profile must be benchmarked on the lowest supported Android device before a
stable release and may only increase through a versioned migration.

## Password handling

- Treat the master password as exact user input: no trim, case conversion, or
  Unicode normalization.
- Prefer `CharArray`/`Uint8Array`; erase temporary arrays in `finally` blocks.
- Kotlin and JavaScript strings are immutable, so complete memory erasure cannot
  be guaranteed. Keep their lifetime short and never cache them.
- Never log passwords, item fields, decrypted payloads, access tokens, keys,
  clipboard values, request bodies, or autofill datasets.
- Use one generic authentication error for wrong passwords and tampering.
- No recovery key exists in the MVP. Losing the master password loses the vault.

## Android Keystore and biometrics

Biometric unlock is a local convenience, not a second decryption authority.
After a master-password unlock, wrap only the random vault data key with a
non-exportable Android Keystore AES key. Require `BIOMETRIC_STRONG` for every
unwrap via `BiometricPrompt.CryptoObject`; allow no authentication time window.

Keep the biometric-wrapped blob in private local storage, never Drive. Invalidate
the key when biometrics change. Bind the local blob to the vault identifier and
password-protected key wrap, not mutable payload metadata. Normal item revisions
remain usable because they preserve the data key and key wrap. If the key is
missing or invalidated, the local record is corrupt or mismatched, the vault key
wrap changes, or authenticated unwrap/decryption fails, delete the convenience
material and require the master password. A user-cancelled prompt leaves valid
enrollment intact. Do not fall back to an app-defined PIN.

Disable Android backup for vault and key metadata. Assume root, unlocked bootloader,
runtime instrumentation, screen capture malware, or a compromised OS can access
plaintext while the vault is open; Keystore does not solve a live-device compromise.

## Browser boundary

- Store only the encrypted file and non-secret preferences in `storage.local`.
- Hold unlocked state only in the background worker. Lock on idle timeout,
  browser lock/suspend, explicit lock, extension reload, or worker termination.
- Content scripts receive the smallest selected record needed for the active
  origin. Never expose a general search/dump API to page code.
- Match normalized origins and registrable domains deliberately; never use
  substring matching. Require explicit confirmation for HTTP, IP literals,
  untrusted frames, saved wildcard rules, and cross-origin iframes.
- Password fields should not be inserted until the user selects an entry.
- Credential capture is restricted to visible editable fields in a submitted
  top-frame HTTPS form. The background validates the sender tab, frame, and exact
  origin; a page-supplied origin is never treated as authority.
- Captured candidates are memory-only, limited to one per tab and two minutes,
  and cleared on dismissal, navigation out of the exact origin, tab close, lock,
  suspension/termination, reload, or restart. Never persist candidates before
  explicit save/update confirmation.
- In-page prompts may show the verified origin, proposed hostname title, and
  account identifiers. They must never insert a captured or stored password into
  the prompt DOM.
- Clipboard writes expire and are best effort; explain that clipboard managers
  and other applications may retain history.

JavaScript cannot guarantee heap wiping. Short session lifetime, isolation, and
minimal message surfaces are the compensating controls.

## Session and clipboard controls

- The inactivity timeout is encrypted vault data and is limited to 1–60
  minutes. Android and browser runtimes calculate deadlines from monotonic
  process clocks rather than persisted wall-clock timestamps.
- Android locks after 15 seconds in the background. Browsers also lock on idle,
  OS/browser lock, worker suspension or termination, extension reload, and
  explicit lock. A status check is observation, not activity.
- Clipboard clearing is limited to 15–120 seconds. Ironkeep clears only the
  exact value or Android clip label it most recently wrote. A later clipboard
  write by the user or another application is preserved.
- Chromium requires `clipboardRead`, `clipboardWrite`, and `offscreen` for its
  isolated clipboard document. Firefox requires `clipboardRead` and
  `clipboardWrite`; both manifests require `idle` for lock-state events. These
  permissions are confined to session safety and do not permit vault logging or
  page-wide credential capture.
- Clipboard clearing is best effort. Operating systems, keyboards, clipboard
  managers, and other applications may retain history before Ironkeep clears
  the active value.

## Google Drive and OAuth

Request only `https://www.googleapis.com/auth/drive.appdata`. Store exactly one
encrypted file in `appDataFolder`. Access tokens belong in platform credential
stores or provider-managed caches, never inside the vault file, source tree, or
logs. OAuth client IDs are public identifiers; client secrets do not belong in
an installed app or browser extension.

Drive/Google can observe account identity, file existence, size, update times,
and traffic timing. The envelope also exposes format/version, vault UUID,
revision, writer-device identifier, update timestamp, KDF parameters, and
ciphertext lengths. Item names and values remain encrypted.

Google account compromise permits copying, deleting, replaying, or replacing
ciphertext, but not decrypting it without the master password. A weak master
password remains vulnerable to offline guessing. Drive is availability and
rollback infrastructure, not a trusted confidentiality service.

## Sync integrity

AES-GCM detects modifications but cannot tell whether an authentic old snapshot
was replayed. Clients retain the highest accepted revision per vault and warn on
lower remote revisions. ETag conditional writes prevent ordinary lost updates.
They do not defeat a malicious provider with full rollback capability. Later,
optionally anchor revision history across devices with signed checkpoints; do
not pretend that a local-only remembered revision survives every reinstall.

Conflicts preserve both encrypted descendants. A client must never select a
winner only from wall-clock time because clocks drift and can be manipulated.

## Exports and imports

Plain CSV export is intentionally dangerous: show an explicit warning, require
reauthentication, write through the system document picker, never keep an app
copy, and remind the user to delete it securely. Prefer encrypted `.ikv` export.

Importers are hostile-input parsers. Stream input, impose byte/item/field limits,
neutralize spreadsheet formula prefixes on CSV export, reject invalid encodings,
and stage a preview before committing one atomic vault mutation.

## Release and supply chain

- Pin dependency and action versions; review lockfile changes.
- Run tests, type checks, lint, secret scanning, dependency review, and release
  builds in GitHub Actions.
- Sign Android release artifacts with a protected key outside Git.
- Publish checksums and provenance. Build extension ZIPs from clean tagged source.
- Never commit APK/AAB/ZIP outputs, `local.properties`, keystores, access tokens,
  OAuth secret JSON, or generated build trees.

## Production gates

1. Independent review of file format, nonce lifecycle, KDF bounds, and both
   implementations.
2. Cross-platform vectors covering every item type, Unicode, corruption, and
   version rejection.
3. Hardware-device testing of biometric enrollment changes, lockouts,
   cancellation, process/activity recreation, and Keystore invalidation.
4. Complete OAuth authorization and revocation for all three clients.
5. Three-way sync/merge tests, interrupted-write tests, duplicate-remote tests,
   replay warnings, and large-vault tests.
6. Autofill phishing, iframe, associated-domain/package, and message-origin tests.
7. Fuzz importers and envelope parsers; audit CSV handling.
8. Reproducible signed releases, SBOM, dependency review, and external penetration
   testing.

Useful primary references: [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106),
[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
and [BiometricPrompt](https://developer.android.com/identity/sign-in/biometric-auth).
