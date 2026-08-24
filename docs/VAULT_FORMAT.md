# Ironkeep vault format v1

The `.ikv` file is UTF-8 JSON. The normative structural schema is
[`shared/schemas/vault-file.schema.json`](../shared/schemas/vault-file.schema.json).
The cryptographic rules in this document are also normative.

## Envelope

```json
{
  "format": "ironkeep-vault",
  "fileVersion": 1,
  "vaultId": "uuid",
  "revision": 1,
  "updatedAt": "2026-08-23T00:00:00.000Z",
  "writerDeviceId": "uuid",
  "kdf": {
    "algorithm": "argon2id",
    "salt": "base64url",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 4
  },
  "keyWrap": {
    "algorithm": "aes-256-gcm",
    "nonce": "base64url",
    "ciphertext": "base64url-ciphertext-plus-tag"
  },
  "payload": {
    "algorithm": "aes-256-gcm",
    "nonce": "base64url",
    "ciphertext": "base64url-ciphertext-plus-tag"
  }
}
```

All binary values use RFC 4648 URL-safe base64 without padding. Timestamps are
UTC RFC 3339 strings. Revisions are positive safe integers. AES-GCM ciphertext
stores the 16-byte authentication tag appended by the platform API.

## Key derivation and wrapping

Encode the exact master-password code points as UTF-8. Do not normalize or trim.
Derive 32 bytes with Argon2id v1.3 and the parameters stored in `kdf`.

The key-wrap authenticated additional data is compact UTF-8 JSON for this exact
array, in this exact order:

```json
["IronkeepKeyWrap","ironkeep-vault",1,"<vaultId>","argon2id","<salt>",<memoryKiB>,<iterations>,<parallelism>]
```

Encrypt the random 32-byte vault data key using AES-256-GCM, a fresh 12-byte
nonce, a 128-bit tag, and that AAD. This creates `keyWrap.ciphertext`.

## Payload encryption

Serialize `VaultPayload` as compact UTF-8 JSON. Its `schemaVersion`, `vaultId`,
`revision`, `updatedAt`, and `writerDeviceId` must equal the outer values.

The payload AAD is compact UTF-8 JSON for this exact array:

```json
["IronkeepPayload","ironkeep-vault",1,"<vaultId>",<revision>,"<updatedAt>","<writerDeviceId>","aes-256-gcm","<keyWrapNonce>","<keyWrapCiphertext>"]
```

Encrypt using the vault data key, a new independent 12-byte nonce, and a 128-bit
tag. Never reuse a nonce with the same key. Each payload rewrite gets a fresh
nonce, including retries after interrupted persistence.

JSON object key ordering in the outer file is not significant. AAD ordering is
significant because it is defined as an array. Producers must use compact JSON
with no spaces for AAD. Strings use normal JSON escaping and UTF-8.

## Payload

`VaultPayload` contains:

- version, vault UUID, revision, timestamp, and writer-device UUID;
- login, secure-note, credit-card, and identity records;
- categories and tags;
- per-item favorite state and revisions;
- deletion tombstones;
- local behavior preferences that are safe to synchronize.

Secrets are ordinary fields only inside the encrypted payload. Token/provider
credentials and biometric blobs are device-local and must never be added.

## Validation order

1. Reject files above the configured byte limit before JSON parsing.
2. Reject unknown `format`, file version, algorithms, invalid base64url, or
   out-of-range lengths.
3. Bound `vaultId` and `writerDeviceId` to 128 characters.
4. Bound Argon2 to 19–262144 KiB, 2–10 iterations, and parallelism 1–8 before
   invoking the KDF.
5. Authenticate/unwrap the data key, then authenticate/decrypt the payload.
6. Strictly decode the supported schema and compare all duplicated metadata.
7. Return one authentication failure for wrong password or authentication-tag
   failure. Return a format/version error only for unauthenticated structural
   rejection.

Unknown future file versions must fail closed. Schema migrations occur only
after successful authentication, produce a new encrypted revision, and preserve
the original encrypted file until the replacement is durably written.

## Master-password change

After a current-password unlock, derive a new key-encryption key using a new
random salt and chosen current KDF profile. Rewrap the existing data key with a
new random wrap nonce. Re-encrypt the payload with a new payload nonce because
its AAD includes the key wrap. Increment the revision. Destroy the old biometric
convenience blob and enroll it again.

## Test vector

[`shared/test-vectors/vault-v1.json`](../shared/test-vectors/vault-v1.json) is a
deterministic interoperability vector. It deliberately uses the accepted test
floor (19 MiB, 2 iterations, parallelism 1), not the production profile. Both
TypeScript and Kotlin must decrypt it. Never copy its password, keys, salt, or
nonces into production.
