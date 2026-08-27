# Ironkeep

Ironkeep is an open-source, offline-first password manager for Android and
Chromium/Firefox browsers. Vaults are encrypted locally with Argon2id and
AES-256-GCM. Google Drive sync is optional and stores one opaque encrypted
file in the user's Drive application-data folder. Ironkeep has no backend.

> Security status: pre-audit starter. Do not trust it with production secrets
> until the interoperability vectors, AutofillService, importers, OAuth flows,
> and an independent cryptographic review are complete.

## Locked stack

- Android: Kotlin, Jetpack Compose, Material 3; Android only. No iOS target.
- Extensions: TypeScript, React, Tailwind CSS, Manifest V3, and
  `webextension-polyfill` for Firefox compatibility.
- Shared contract: TypeScript core for extensions plus language-neutral file
  format, schemas, and test vectors consumed by the Kotlin implementation.
- Infrastructure: no custom backend and no Ironkeep account database.

## Repository

```text
Ironkeep/
├── android/                  # Kotlin + Compose Android app
├── extensions/
│   ├── chromium/             # Chromium Manifest V3 package
│   └── firefox/              # Firefox Manifest V3 package
├── shared/
│   ├── src/                  # Crypto, models, generator, health logic
│   ├── extension-ui/         # Shared React UI/runtime for both extensions
│   └── test-vectors/         # Cross-platform compatibility vectors
├── docs/
├── .github/
├── .gitignore
├── README.md
└── LICENSE
```

## Start here

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Vault file format](docs/VAULT_FORMAT.md)
- [Google Drive sync](docs/SYNC.md)
- [Product scope](docs/ROADMAP.md)
- [Windows 10 build guide](docs/WINDOWS_BUILD.md)
- [Interface and 21st.dev integration](docs/DESIGN.md)
- [Privacy notice](docs/PRIVACY.md)
- [Terms of use](docs/TERMS.md)
- [Contributing](CONTRIBUTING.md)

## Verify the scaffold

Windows PowerShell:

```powershell
npm ci
npm run typecheck
npm test
npm run build
Set-Location .\android
.\gradlew.bat testDebugUnitTest lintDebug
```

See the [complete Windows 10 guide](docs/WINDOWS_BUILD.md) for Android Studio,
extension loading, OAuth registration, and release steps.

Compiled APKs, extension packages, signing files, OAuth secrets, and generated
build trees are excluded from Git. Release binaries belong only in GitHub
Releases.

## Security

Ironkeep is pre-audit alpha software. Report vulnerabilities privately using
the instructions in [`.github/SECURITY.md`](.github/SECURITY.md); do not post
secrets, exploit details, or vulnerable vault files in a public issue.

## License

Ironkeep source code is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE). Third-party code, fonts,
and assets remain under their respective licenses; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
