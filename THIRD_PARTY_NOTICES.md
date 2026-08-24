# Third-party notices

Ironkeep is licensed under `AGPL-3.0-only`. The following third-party works are
not relicensed by Ironkeep; their original licenses and copyright notices
continue to apply.

This file covers direct runtime dependencies and design-source provenance in
the current source tree. Exact resolved JavaScript dependency versions and
their SPDX license identifiers are recorded in `package-lock.json`. Android
dependency coordinates and versions are recorded in the Gradle build files.

## Interface source provenance

The browser interface adapts selected component patterns distributed through
21st.dev from the Origin UI project. The adapted source is stored locally and
no code is loaded from 21st.dev at runtime.

- Origin UI: MIT License
- Project: <https://originui.com/>
- Source: <https://github.com/shadcn/originui>
- Imported pattern references: `docs/THIRD_PARTY_UI.md`

Copyright (c) 2025 Origin UI

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Before importing additional upstream source, copy its current notice into this
file and verify the license at the cited source revision.

## Bundled fonts

- Manrope, Copyright 2019 The Manrope Project Authors:
  SIL Open Font License 1.1
  (<https://github.com/sharanda/manrope>)
- Newsreader, Copyright 2020 The Newsreader Project Authors:
  SIL Open Font License 1.1
  (<https://github.com/productiontype/Newsreader>)

The font files are supplied through the `@fontsource-variable/manrope` and
`@fontsource-variable/newsreader` packages. The complete SIL Open Font License
1.1 text is included in each package's `LICENSE` file and is available at
<https://openfontlicense.org/open-font-license-official-text/>.

## Browser and shared runtime libraries

| Project | License | Source |
| --- | --- | --- |
| React and React DOM | MIT | <https://github.com/facebook/react> |
| Radix UI Primitives | MIT | <https://github.com/radix-ui/primitives> |
| class-variance-authority | Apache-2.0 | <https://github.com/joe-bell/cva> |
| clsx | MIT | <https://github.com/lukeed/clsx> |
| hash-wasm | MIT | <https://github.com/Daninet/hash-wasm> |
| Lucide | ISC | <https://github.com/lucide-icons/lucide> |
| tailwind-merge | MIT | <https://github.com/dcastil/tailwind-merge> |
| webextension-polyfill | MPL-2.0 | <https://github.com/mozilla/webextension-polyfill> |

## Android runtime libraries

| Project | License or terms | Source |
| --- | --- | --- |
| AndroidX and Jetpack Compose | Apache-2.0 | <https://github.com/androidx/androidx> |
| Bouncy Castle | Bouncy Castle License | <https://www.bouncycastle.org/licence.html> |
| Kotlin and kotlinx libraries | Apache-2.0 | <https://github.com/JetBrains/kotlin> |
| OkHttp | Apache-2.0 | <https://github.com/square/okhttp> |
| Google Play services libraries | Google APIs Terms of Service | <https://developers.google.com/terms> |

## Build-only dependencies

Compilers, bundlers, test runners, type declarations, Gradle plugins, and other
build-only packages are not part of Ironkeep's own license grant. Their names,
versions, and license metadata remain available in `package-lock.json`, Gradle
metadata, and the corresponding upstream distributions.

This notice is informational and is not a substitute for the complete license
text shipped by each dependency. Release maintainers must regenerate and review
dependency notices whenever dependencies or imported UI source change.
