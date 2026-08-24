# Windows 10 setup and build

Commands use PowerShell from the repository root.

## 1. Install tools

1. Install [Git for Windows](https://git-scm.com/download/win).
2. Install [Node.js 22 LTS or newer](https://nodejs.org/en/download). Confirm:

   ```powershell
   node --version
   npm --version
   ```

3. Install [Android Studio](https://developer.android.com/studio). In SDK
   Manager install:
   - Android SDK Platform 36
   - Android SDK Build-Tools 35.0.0 or newer compatible build tools
   - Android SDK Platform-Tools
   - Android SDK Command-line Tools
4. Use Android Studio's bundled JDK or install a 64-bit JDK 17/21. Confirm:

   ```powershell
   java -version
   ```

The checked-in Gradle wrapper downloads Gradle 9.5.0. Do not install a global
Gradle or replace the wrapper with the machine's version.

## 2. Clone and install JavaScript dependencies

```powershell
git clone https://github.com/roryjmahoney/Ironkeep-Password-Manager.git
Set-Location .\ironkeep
npm ci
```

`npm ci` must agree with `package-lock.json`. Review any lockfile change before
commit. The extension bundles all fonts, React code, and WebAssembly locally.

## 3. Configure the Android SDK

Opening `android\` in Android Studio normally creates ignored
`android\local.properties`. To create it manually, use the actual SDK path and
escape the drive colon:

```properties
sdk.dir=C\:/Users/YOUR_NAME/AppData/Local/Android/Sdk
```

Never commit `local.properties`. If Android Studio uses a different SDK, copy
its displayed path from **Settings > Languages & Frameworks > Android SDK**.

## 4. Verify everything

```powershell
npm run typecheck
npm test
npm run build

Set-Location .\android
.\gradlew.bat testDebugUnitTest lintDebug
Set-Location ..
```

The Kotlin tests read `shared\test-vectors\vault-v1.json`, proving the Android
implementation can decrypt a TypeScript-produced envelope.

## 5. Run Android

1. Open the `android` directory in Android Studio.
2. Let Gradle sync using the bundled or selected JDK.
3. Create an Android 9/API 28-or-newer emulator, or enable USB debugging on a
   test device.
4. Select the `app` run configuration and press Run.

Command-line debug APK:

```powershell
Set-Location .\android
.\gradlew.bat assembleDebug
```

Output is under `android\app\build\outputs\apk\debug\`. It is ignored and must
not be committed.

To enable Autofill on a test device, install/run the app, then open Android
Settings and choose Ironkeep under **Passwords, passkeys & autofill**. Android
requires the user to enable an `AutofillService`; installation cannot enable it.

## 6. Run Chromium extension

```powershell
npm run build --workspace @ironkeep/chromium-extension
```

Then:

1. Open `chrome://extensions` (or the equivalent Edge/Brave/Opera page).
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `extensions\chromium\dist`.
5. Pin Ironkeep and open the popup.

For edit/watch mode:

```powershell
npm run dev --workspace @ironkeep/chromium-extension
```

Reload the extension after the watcher rebuilds.

## 7. Run Firefox extension

```powershell
npm run build --workspace @ironkeep/firefox-extension
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
and select `extensions\firefox\dist\manifest.json`. Temporary add-ons disappear
when Firefox closes.

## 8. Configure Google OAuth and Drive

Do this only when implementing/testing optional sync:

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen. During development add explicit test users.
3. Create separate OAuth client registrations for Android, Chromium, and Firefox.
4. Android: register package `dev.ironkeep.app` plus the debug/release certificate
   SHA-1/SHA-256 as appropriate. Implement Credential Manager sign-in and
   `AuthorizationClient` incremental `drive.appdata` authorization.
5. Chromium: register the extension identity and replace the manifest's
   `REPLACE_WITH_CHROMIUM_OAUTH_CLIENT_ID...` placeholder for local builds.
6. Firefox: register the exact URL returned by
   `browser.identity.getRedirectURL()` and implement Authorization Code + PKCE.
7. Verify only `drive.appdata` is requested and `ironkeep-vault.ikv` is created
   in `appDataFolder`.

OAuth client IDs are public configuration. Client secrets, downloaded OAuth
secret JSON, access/refresh tokens, service-account keys, and signing keystores
must never enter the repository. Ironkeep does not use a service account.

## 9. Release artifacts

Do release work from a clean signed tag. Production requirements:

- Android release keystore supplied through protected CI secrets or an isolated
  signing machine; never base64 files into source.
- `assembleRelease`/`bundleRelease`, R8 rules, instrumentation tests, and signing
  verification.
- Chromium/Firefox packages built from the same tag and checked by their store
  tooling.
- SHA-256 checksums, SBOM, provenance, and source tag attached to the GitHub
  Release.

APKs, AABs, APKS, CRXs, XPIs, and ZIPs are ignored. Do not use `git add -f`.
Publish binaries only as GitHub Release assets.

## Common errors

- **SDK location not found**: fix ignored `android\local.properties`; escape the
  Windows drive colon as shown above.
- **Android dependency requires a newer compile SDK**: do not blindly upgrade one
  dependency. Keep the Compose BOM/toolchain compatibility set documented in
  `android\app\build.gradle.kts`, then update AGP/SDK/Compose together.
- **Gradle uses an unexpected JDK**: set Android Studio's Gradle JDK to 17/21 or
  correct `JAVA_HOME` for that terminal.
- **OAuth invalid client/redirect**: verify the platform-specific client, stable
  extension ID, certificate fingerprint, and exact redirect URI.
- **Firefox extension disappears**: temporary add-ons must be loaded again after
  restarting Firefox.
