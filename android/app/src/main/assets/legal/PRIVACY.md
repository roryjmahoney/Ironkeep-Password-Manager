# Ironkeep Privacy Notice

**Status:** Effective with Ironkeep 0.9.1  
**Last updated:** August 26, 2026

Ironkeep is an open-source, offline-first password manager for Android and
Chromium- and Firefox-based browsers. This notice explains how the official
Ironkeep applications and browser extensions access, use, store, and disclose
information.

Ironkeep does not operate a backend, web vault, advertising system, analytics
service, or account database. Vault contents are encrypted and stored on the
user's device. Ironkeep's developer does not receive the contents of a user's
vault through the application.

Ironkeep is pre-audit alpha software. It should not yet be trusted with
production-critical secrets.

## Information Ironkeep handles

Ironkeep handles the following information only to provide password-manager
features selected by the user:

- **Vault contents:** Logins, usernames, passwords, website addresses, Android
  application identifiers, secure notes, payment-card details, identities,
  favorites, settings, and deletion tombstones.
- **Vault security material:** The master password while the user enters it,
  cryptographic keys, salts, nonces, encrypted vault metadata, and a random
  vault and writer-device identifier. The master password is not retained after
  the operation that requires it.
- **Autofill and form information:** Relevant form-field labels and values,
  the active website origin, or the Android application package needed to find,
  fill, generate, save, or update a credential. Ironkeep does not intentionally
  collect general browsing history.
- **Biometric authentication:** Android may provide the result of a biometric
  authentication operation. Ironkeep does not receive or store fingerprints,
  face images, or biometric templates. Android Keystore protects a local copy
  of the vault data key for authentication-per-use unlock.
- **Clipboard information:** A secret the user explicitly copies and a local
  ownership marker used to clear that clipboard value after the configured
  timeout. Other applications, keyboards, operating systems, or clipboard
  managers may read or retain clipboard history outside Ironkeep's control.
- **Local settings:** Automatic-lock duration, clipboard-clearing duration,
  password-generator settings, and other application preferences.

## How information is used

Ironkeep uses this information to:

- create, unlock, search, edit, and encrypt the user's vault;
- match credentials to an exact website origin or authorized Android
  application;
- fill credentials only after the user selects an offered entry;
- detect submitted credential changes and offer an explicit save or update;
- generate passwords locally;
- authenticate restore files and create encrypted backup snapshots;
- lock the vault and clear Ironkeep-owned clipboard content; and
- detect conflicts and synchronize an encrypted vault if optional Google Drive
  synchronization is enabled in a future release.

Ironkeep does not use vault or browsing information for advertising, profiling,
credit decisions, data brokerage, or sale.

## Local processing and storage

Vault contents are encrypted with AES-256-GCM. The master password is processed
locally with Argon2id to unlock the encrypted vault data key. Plaintext vault
contents exist only while the vault is unlocked and are not written as a
plaintext database or search index.

Android stores the encrypted vault in application-private storage and disables
Android backup for private vault and key material. Browser extensions store the
encrypted vault in extension-local storage. An unlocked browser session exists
only in extension memory and is discarded on lock, timeout, browser or operating
system lock, extension reload, or background-worker termination.

Autofill candidates that have not been confirmed are held only in memory for up
to two minutes and are cleared on dismissal, lock, timeout, navigation away,
application or tab closure, replacement by a newer candidate, or successful
save. Ironkeep does not place an unconfirmed candidate in the vault or logs.

## Browser-extension access

The browser extensions require access needed for their password-manager
features:

- `storage` stores the encrypted vault and non-secret local state;
- `activeTab`, `scripting`, and website access allow Ironkeep to identify
  relevant login and password fields, match the exact origin, fill a selected
  login, and offer credential capture;
- `clipboardRead` and `clipboardWrite` support user-requested copying and
  clearing of Ironkeep-owned clipboard content;
- `idle` locks the vault when the browser or operating system becomes idle or
  locked;
- Chromium's `offscreen` permission provides an isolated document for clipboard
  operations; and
- `identity` and access to Google APIs are reserved for optional Google Drive
  authorization. Google Drive sync is not enabled in the 0.9.1 release.

Website and form information is processed locally for these user-facing
features. It is not transmitted to Ironkeep's developer.

Ironkeep's use of information received from Google APIs will comply with the
Chrome Web Store User Data Policy, including its Limited Use requirements.

## Network activity and optional Google Drive sync

Ironkeep 0.9.1 does not provide working Google Drive synchronization. Its core
vault, search, editing, generation, backup, restore, and Autofill features are
designed to work without an Ironkeep server.

If a later release enables Google Drive synchronization, it will be optional and
will require an explicit Google authorization action. Ironkeep will request only
the `drive.appdata` scope and will store exactly one encrypted
`ironkeep-vault.ikv` file in the selected Google account's hidden Drive
application-data folder. Google credentials will identify the Drive location;
they will never unlock, recover, or replace the master password.

Google may then process the account authorization and observe transport
metadata, including the encrypted file's existence, size, update time, and
traffic timing. The encrypted envelope exposes technical metadata such as vault
format version, random vault and writer-device identifiers, revision, update
time, key-derivation parameters, and ciphertext length. Vault item names and
values remain encrypted. Ironkeep's developer will not receive the Google token
or encrypted vault.

The privacy notice and applicable store disclosures must be reviewed and
updated when Drive sync becomes available.

## Information Ironkeep does not collect

The official Ironkeep application does not include developer-operated:

- analytics or telemetry;
- advertising or tracking SDKs;
- plaintext crash reporting;
- a user account or account database;
- a password-recovery or key-escrow service; or
- a server that receives vault contents.

Application stores, browsers, operating-system vendors, GitHub, and Google may
independently process installation, update, diagnostic, account, or support
information under their own terms and privacy notices. That platform processing
is not controlled by Ironkeep.

## Sharing and disclosure

Ironkeep does not sell personal information. Ironkeep does not share vault
contents with advertisers, data brokers, or the developer.

Information leaves the local application only when the user deliberately uses
a platform feature that requires it, such as:

- filling a selected value into a website or Android application;
- copying a selected value to the system clipboard;
- saving an encrypted `.ikv` snapshot to a location selected through the system
  file picker; or
- in a future release, enabling optional encrypted Google Drive sync.

Users should never attach a real vault, master password, OAuth token, signing
key, or unredacted secret to a GitHub issue or support request.

## Retention and deletion

- The encrypted local vault remains until the user deletes the vault, clears
  the extension's local data, or uninstalls the application. Uninstallation and
  browser behavior may vary by platform.
- Deleting an individual vault item removes its contents from the active item
  list but retains an encrypted deletion tombstone to prevent synchronization
  from restoring the deleted item.
- Android biometric convenience material remains in application-private storage
  until the user disables biometrics, replaces or restores the vault, deletes
  application data, or the key is invalidated.
- User-created encrypted backup files remain wherever the user saved them until
  the user deletes them. Ironkeep does not retain another developer-accessible
  copy.
- Unconfirmed Autofill candidates are retained in memory for no more than two
  minutes and are normally cleared earlier when their lifecycle ends.
- If future Google Drive sync is enabled, disconnecting sync will remove local
  authorization and sync metadata without silently deleting the local vault.
  Remote deletion will require a separate explicit action.

Ironkeep has no developer-hosted account or server-side vault data for the user
to ask the developer to delete.

## Security limitations

Ironkeep uses authenticated encryption, bounded parsing, automatic locking, and
platform security features. No software can guarantee absolute security. A
compromised or rooted device, malicious browser extension, hostile accessibility
service, clipboard manager, screen-capture tool, weak master password, or loss
of the user's own files may expose or destroy data.

Ironkeep cannot recover a forgotten master password. Users are responsible for
maintaining encrypted backups and protecting their devices and master password.

## Changes to this notice

This notice may change when Ironkeep adds features, changes permissions, enables
optional network services, or must address legal or store requirements. The
date at the top will be updated. Material changes should be disclosed in the
application and store listing before the changed data practice begins.

## Contact

For general privacy questions, open a minimal inquiry in the Ironkeep GitHub
issue tracker:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/issues>

Do not include passwords, vault files, tokens, payment information, identity
documents, or other secrets in a public issue. Report suspected vulnerabilities
privately through GitHub Security Advisories:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/security/advisories/new>
