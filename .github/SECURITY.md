# Security policy

Ironkeep handles high-value secrets. Please report suspected vulnerabilities
privately and responsibly.

## Supported versions

Ironkeep is currently pre-audit alpha software. Only the newest GitHub release
and the current `main` branch receive security fixes. No version is currently
recommended for production-critical secrets.

| Version | Security fixes |
| --- | --- |
| Latest alpha | Yes |
| Older releases | No |

## Reporting a vulnerability

Use GitHub's private vulnerability reporting form:

<https://github.com/roryjmahoney/Ironkeep-Password-Manager/security/advisories/new>

Do not open a public issue. Do not include real passwords, master passwords,
recovery material, OAuth tokens, signing keys, or an unredacted vault file.
Use synthetic test data and include:

- affected Ironkeep version and platform;
- reproduction steps or a minimal proof of concept;
- expected and observed behavior;
- likely impact and any known mitigations;
- whether the issue is already public.

You should receive an acknowledgement within seven days. Fix and disclosure
timing depends on severity and reproducibility. Please allow time for a patch
and release before publishing technical details.

## Scope

Security-relevant reports include cryptography or key handling, vault parsing,
autofill boundary failures, extension permission bypasses, authentication or
biometric bypasses, Google Drive sync disclosure, secret logging, and release
or update integrity.

Reports about unsupported modified builds, social engineering, denial of
service requiring unrealistic resources, or findings without security impact
may be closed without an advisory.

## Research safety

Test only with accounts, devices, and vaults you own or are authorized to use.
Avoid privacy violations, service disruption, data destruction, persistence,
and access beyond what is required to demonstrate the issue.
