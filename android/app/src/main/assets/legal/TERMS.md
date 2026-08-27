# Ironkeep Terms of Use

**Status:** Effective with Ironkeep 0.9.1  
**Last updated:** August 26, 2026

These Terms of Use apply to official Ironkeep Android applications, browser
extensions, release artifacts, documentation, and project-operated pages
(collectively, "Ironkeep"). By installing or using Ironkeep, you acknowledge
these terms.

## Open-source license controls

Ironkeep's source code is licensed under the GNU Affero General Public License
version 3.0 only (`AGPL-3.0-only`). The AGPL governs permission to copy, modify,
and distribute covered source and object code. These Terms do not revoke,
restrict, or replace rights granted by the AGPL. If these Terms conflict with
the AGPL regarding covered software, the AGPL controls.

Third-party software, fonts, libraries, and assets remain subject to their own
licenses and notices.

## Pre-release status

Ironkeep is pre-audit alpha software. It has not completed independent
cryptographic review, penetration testing, every planned platform integration,
or all production release gates. It may contain defects that prevent access to
data, disclose data, fill incorrect fields, corrupt a vault, or otherwise fail.

Do not use current pre-release versions as the only storage location for
production-critical credentials, financial information, identity information,
or other irreplaceable secrets. Maintain current encrypted backups and test
restore procedures.

## The service Ironkeep provides

Ironkeep provides local password-management software. Ironkeep does not provide
an Ironkeep-hosted account, backend, web vault, password-recovery service, or
guaranteed cloud storage.

The master password decrypts the vault locally. Ironkeep's developer cannot
recover a forgotten master password or decrypt a user's vault. Loss of the
master password, encrypted vault, device, or backup may permanently prevent
access to stored data.

Features may be incomplete, changed, suspended, or removed during pre-release
development. Release notes and documentation identify known limitations but may
not list every defect.

## User responsibilities

You are responsible for:

- choosing and protecting a strong, unique master password;
- maintaining encrypted backups in locations you control;
- verifying Autofill targets and filled values before submitting a form;
- protecting devices, browser profiles, Google accounts, and exported files;
- using Ironkeep only with accounts, applications, websites, and data you are
  authorized to access;
- complying with applicable law and third-party terms; and
- testing pre-release software with synthetic information instead of real
  secrets whenever practical.

You must not use official Ironkeep distribution channels, issue trackers, or
project infrastructure to distribute malware, steal credentials, interfere with
others' systems, expose another person's data, or submit secrets for which you
lack authorization. This rule governs project-operated infrastructure and does
not limit rights granted for the software itself by the AGPL.

## User data and privacy

You retain your rights in information you place in a vault. Ironkeep does not
claim ownership of vault contents. Data handling by official Ironkeep releases
is described in the [Ironkeep Privacy Notice](PRIVACY.md).

Do not submit real passwords, master passwords, recovery information, OAuth
tokens, signing keys, payment-card data, identity documents, or unredacted vault
files through public issues or other public project channels.

## Third-party platforms

Ironkeep may operate through Android, Chromium-based browsers, Firefox, GitHub,
application stores, and, in a future release, optional Google Drive services.
Those platforms are provided by third parties and are governed by their own
terms, privacy notices, availability, and security practices.

Ironkeep does not guarantee that a third-party platform will continue to permit
installation, Autofill, extension APIs, biometric operations, file access, or
cloud access. Revocation, account loss, provider outages, platform updates, or
third-party deletion may interrupt features or destroy access to remotely stored
data.

## Updates and compatibility

Updates may change functionality, security requirements, vault-format support,
permissions, or platform compatibility. Back up the encrypted vault before
installing pre-release updates or moving data between platforms.

Only the latest alpha release and current `main` branch are intended to receive
security fixes during pre-release development. Older versions may remain
vulnerable or incompatible.

## No support commitment

Community support, issue responses, updates, and security fixes are provided on
a best-effort basis. No response time, maintenance period, feature delivery,
compatibility period, or recovery outcome is promised unless separately agreed
in writing.

## Disclaimer of warranties

To the maximum extent permitted by applicable law, Ironkeep is provided "as
is" and "as available," without warranties or conditions of any kind, whether
express, implied, or statutory. This includes warranties of merchantability,
fitness for a particular purpose, title, non-infringement, accuracy,
availability, security, compatibility, and uninterrupted or error-free
operation.

Nothing in these Terms excludes a warranty or consumer right that cannot
lawfully be excluded. The warranty provisions of the AGPL also apply to covered
software.

## Limitation of liability

To the maximum extent permitted by applicable law, Ironkeep's contributors and
distributors will not be liable for indirect, incidental, special,
consequential, exemplary, or punitive damages, or for loss of credentials,
vault data, access, revenue, profits, goodwill, privacy, or business
opportunities arising from use of or inability to use Ironkeep.

Nothing in these Terms limits liability that cannot lawfully be limited. The
liability provisions of the AGPL also apply to covered software.

## Stopping use

You may stop using Ironkeep at any time. Before uninstalling, export any
encrypted backup you intend to keep and verify that it can be restored.

The project may stop distributing a particular official build or providing
project-operated services. That does not terminate rights already granted under
the AGPL for covered software.

## Changes to these Terms

These Terms may be updated as Ironkeep changes or legal and store requirements
develop. The date at the top will be updated. Material changes should be
identified before they apply to a new official release.

## Contact

For a question about these Terms, open an issue without secrets or personal
information:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/issues>

Report security vulnerabilities only through the private reporting form:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/security/advisories/new>
