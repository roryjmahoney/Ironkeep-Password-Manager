# Google Drive sync protocol

Drive sync is optional. A user can remain local-only forever. In the product,
Google Sign-In can provide an account-like way to connect devices and locate
the user's vault. There is still no separate Ironkeep account: Google identity
selects the Drive application-data space, while the master password decrypts
the vault locally.

## Remote object

The remote object is one compact whole-vault file:

- Scope: `https://www.googleapis.com/auth/drive.appdata`
- Space/parent: `appDataFolder`
- Name: `ironkeep-vault.ikv`
- MIME type: `application/vnd.ironkeep.vault`
- Count: exactly one non-trashed file per Google account
- Body: byte-for-byte v1 encrypted vault envelope

The app-data folder is hidden from the normal Drive UI and is only accessible to
the creating application. It is not a backup service: uninstall/revocation,
account loss, provider deletion, or user action may destroy access. Users still
need explicit encrypted `.ikv` snapshots. These are user-selected files outside
the hidden app-data folder and do not create additional synced vault objects.

See Google's [application-data folder](https://developers.google.com/drive/api/guides/appdata)
and [file upload](https://developers.google.com/drive/api/guides/manage-uploads)
documentation.

## Local sync metadata

Store this outside the encrypted payload in platform-private storage:

```text
googleSubjectHash       stable local hash; never an email address
driveFileId
lastAcceptedEtag
lastAcceptedMd5
lastSyncedVaultRevision
lastSyncedCiphertext     encrypted base snapshot for conflict recovery
pendingUpload            boolean
```

This metadata contains no access token and no plaintext item data. Tokens are
obtained from platform authentication APIs and kept in their managed caches or
memory.

## Authorization

### Android

Use Credential Manager for the sign-in identity and Google's
`AuthorizationClient` for incremental Drive authorization. Request
`drive.appdata` only when the user enables sync. Do not request broad `drive`,
`drive.file`, contacts, Gmail, or profile data beyond what the sign-in flow
requires. Revoke authorization and erase sync metadata when the user disconnects.

Primary references: [Credential Manager with Google](https://developer.android.com/identity/sign-in/credential-manager-siwg)
and [Google authorization](https://developers.google.com/identity/authorization/android).

### Chromium

Declare the OAuth client ID and `drive.appdata` scope in the Chromium manifest.
The MV3 background worker obtains short-lived tokens through
`chrome.identity.getAuthToken`. On an authentication failure, remove the cached
token and retry once interactively only after a user gesture.

### Firefox

Use `browser.identity.launchWebAuthFlow`, `browser.identity.getRedirectURL()`,
Authorization Code + PKCE, and a Firefox-specific Google OAuth client. Do not
embed a client secret. Validate `state`; validate the redirect URL exactly; keep
access tokens in memory and refresh material in extension-private storage only
after threat review. Firefox and Chromium need separate OAuth registrations.

Primary references: [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
and [Firefox Identity API](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/identity).

## First connection

1. Finish an explicit Google authorization gesture.
2. List `spaces=appDataFolder` with exact name and `trashed=false`.
3. Zero results:
   - if the local vault exists, create the remote file with multipart upload;
   - immediately re-list; if more than one now exists, enter duplicate conflict;
   - record file ID, ETag/checksum, revision, and encrypted base.
4. One result:
   - download bytes and authenticate with the master password;
   - if no local vault exists, adopt it locally;
   - if a local vault exists with a different `vaultId`, stop and ask whether to
     keep local-only, replace local after encrypted backup, or disconnect;
   - never merge unrelated vault IDs.
5. More than one result: upload nothing. Show every file ID/update time and a
   recovery action. Never guess which duplicate is authoritative.

## Normal synchronization state machine

Let `B` be the last synchronized encrypted base, `L` the current local file,
and `R` the newly downloaded remote file.

```text
remote absent ──► stop; require explicit recreate/restore choice
remote malformed/auth failure ──► quarantine bytes; stop
remote revision below remembered revision ──► rollback warning; stop

L == B and R == B ──► clean
L == B and R != B ──► authenticate R; atomic local replace; clean
L != B and R == B ──► conditional upload L using B's ETag
L != B and R != B ──► conflict; preserve both; upload nothing
```

Equality for transport decisions may use a cryptographic local hash of the
encrypted bytes. ETag and MD5 are provider hints, not authenticity checks.
Authenticity comes only from AES-GCM plus payload/header consistency.

Every update uses `PATCH ...?uploadType=media` with `If-Match: <downloaded ETag>`.
HTTP 412 re-enters the download/state-decision flow. Never retry an upload
unconditionally. Use exponential backoff with jitter for 429/5xx, honor
`Retry-After`, and do not spin while offline.

## Conflict handling

The MVP uses conservative whole-vault conflict preservation:

1. Keep `L` as the working local file.
2. Save `R` as a local encrypted conflict snapshot. Do not place a second file
   on Drive.
3. Block uploads and show both authenticated revisions, update times, and device
   labels after unlock.
4. Let the user choose local, remote, or item-by-item reconciliation.
5. Before committing, preserve encrypted exports of both descendants.
6. Produce a new payload with revision `max(L.revision, R.revision) + 1`, fresh
   timestamp/device ID/nonces, and required tombstones.
7. Re-download current remote and conditionally upload against its current ETag.
8. Only after success replace `B`, clear the conflict state, and retain recovery
   snapshots according to a bounded local policy.

No last-write-wins by timestamp. Clocks are not causal ordering. A later phase
may implement a deterministic three-way item merge: unchanged side yields to
changed side; independent item IDs merge; delete-vs-unchanged deletes; any
same-item concurrent edit or delete-vs-edit remains an explicit user conflict.

## Offline edits and failure cases

- Local saves never wait for Drive. Mark `pendingUpload` and synchronize later.
- Network/auth errors leave local encrypted data untouched.
- A remote deletion is not silently recreated. Ask the user to restore from the
  local copy or disconnect sync.
- A different signed-in Google subject blocks sync until explicitly switched.
- A successful upload is followed by metadata readback. Record the new ETag and
  encrypted base only after confirmation.
- A crash before remote confirmation is recovered by downloading and comparing;
  never assume the request succeeded or failed.
