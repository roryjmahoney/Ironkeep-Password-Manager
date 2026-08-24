# Third-party UI provenance

Ironkeep vendors and adapts source-owned React primitives instead of treating
21st.dev as a runtime dependency. No remote code is loaded by the extension.

Current 21st.dev lineage:

- Origin UI enhanced button registry:
  `https://21st.dev/community/components/originui/button`
- Origin UI input registry and show/hide password pattern:
  `https://21st.dev/community/components/originui/input/show-hide-password-input`
- Origin UI keyboard-hinted search input:
  `https://21st.dev/community/components/originui/input/search-input-with-kbd`
- Origin UI tabs registry:
  `https://21st.dev/originui/tabs`

License notices for the currently incorporated patterns, fonts, and libraries
are recorded in [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Each future imported component must be reviewed before commit for:

1. upstream license compatibility and notice requirements;
2. dependency and bundle impact;
3. keyboard, focus, reduced-motion, and 200% zoom behavior;
4. removal of analytics, remote assets, demo data, and unrelated animation;
5. alignment with Ironkeep semantic tokens and icon family;
6. absence of secret logging or unsafe clipboard behavior.

The 21st.dev CLI may be used in a scratch branch:

```powershell
npx shadcn@latest add https://21st.dev/r/originui/input
```

Move only reviewed source into `shared/extension-ui/src/components`. Never run
third-party registry code directly in production, and never load scripts from a
CDN. Manifest V3 must package all executable code locally.
