# Interface direction

Ironkeep should feel like a precise physical instrument: forged graphite,
warm ivory, restrained brass, hard dividers, and editorial typography. It is
not a card dashboard.

## Visual system

| Token | Dark | Light | Purpose |
|---|---|---|---|
| background | `#111416` | `#F6F3EA` | primary field |
| surface | `#171B1E` | `#FCFAF4` | controls and sheets |
| text | `#F3F0E7` | `#171A1B` | primary copy |
| muted | `#A6ACAE` | `#555C5F` | metadata |
| brass | `#D1A85B` | `#745518` | focus and decisive action |
| line | `#30373B` | `#B9B5AA` | structure |
| danger | `#C85D52` | `#9F3C34` | destructive/error |

- 4 px spacing base; deliberate 8/12/16/20/24/32/40 rhythm.
- Mostly square controls; 2–6 px radii only where touch geometry needs it.
- One-pixel rules create hierarchy. Shadows are rare and indicate an overlay,
  never decoration.
- No gradients, glass, floating metric cards, decorative blobs, or excessive
  pills.
- Use icons from Lucide on web and Material Symbols/Icons on Android. Never use
  emoji as interface icons.

## Typography

Extensions bundle Manrope for functional text and Newsreader for editorial
headings via local `@fontsource-variable` packages. No remote font request and
no Inter/system-default fallback as the intended appearance.

Android's starter theme establishes the same serif/sans/mono hierarchy and
metrics. Before a visual release, add reviewed, license-compatible bundled
`res/font` assets and replace the generic families in `IronkeepTheme.kt`; this is
a release gate, not optional polish. Font files and their licenses must be source
assets, never fetched on first launch, so the interface remains fully offline.

## Layout language

- Extension popup: narrow editorial index, 380 px wide, visible lock state,
  command/search row, tabbed item type, ruled list, and one clear primary action.
- Android: edge-to-edge field with anchored wordmark, a single bordered unlock
  plane, strong display type, and drawer-like ruled lists.
- Item detail: label/value rows divided by rules. Reveal/copy/edit controls sit
  beside their value; secrets are masked by default.
- Empty states explain one action. They are not illustrations inside a card.
- Security warnings use persistent inline bands with action text, not transient
  color alone.

## Motion

- 120–220 ms for state changes; spring only for direct manipulation.
- Lock/unlock crossfade and restrained content reveal; no ornamental looping.
- Respect reduced-motion settings. Security actions never depend on animation.
- Clipboard confirmation is announced accessibly and remains visible long
  enough to perceive.

## Accessibility

- Minimum 4.5:1 text contrast; 3:1 focus/large UI boundaries.
- 44 CSS px web targets and 48 dp Android targets where practical.
- Every icon-only action has an accessible name.
- Full keyboard order, visible `:focus-visible`, Escape-to-close, focus return,
  and no focus trap outside modal surfaces.
- Password reveal reports pressed/expanded state. Errors are associated with the
  field and announced; color never carries meaning alone.
- Browser overlay must isolate styles without defeating zoom or high contrast.

## 21st.dev integration workflow

Ironkeep uses real 21st.dev community patterns as source components, then adapts
them to the product tokens and extension security boundary. Current provenance is
recorded in [THIRD_PARTY_UI.md](THIRD_PARTY_UI.md).

1. Choose one component for a real interaction, not for decoration. Current
   sources are Origin UI's button, password reveal input, search-with-shortcut,
   and tabs patterns.
2. Inspect the complete source, dependencies, license/provenance, keyboard
   behavior, and ARIA before copying. Never execute opaque install commands.
3. Vendor the source into `shared/extension-ui/src/components/ui/`; do not add a
   runtime dependency on 21st.dev.
4. Replace source tokens with Ironkeep CSS variables. Reduce radii/shadows and
   preserve the original interaction/accessibility mechanics.
5. Delete unused variants and dependencies. Keep the local component small
   enough to audit.
6. Record URL, source author/library, retrieval date, modifications, and license.
7. Test at popup dimensions in Chromium and Firefox: mouse, keyboard, screen
   reader names, 200% zoom, dark/light, long translated text, and reduced motion.
8. Review the rendered whole. Repeated cards, identical section boxes, random
   spacing, pastel color, and generic dashboard composition fail the design gate.

Source pages used by the scaffold:

- [Origin UI show/hide password input](https://21st.dev/community/components/originui/input/show-hide-password-input)
- [Origin UI search input with keyboard hint](https://21st.dev/community/components/originui/input/search-input-with-kbd)
- [Origin UI button](https://21st.dev/community/components/originui/button)
- [Origin UI tabs](https://21st.dev/originui/tabs)

21st.dev source is a starting point, not a visual substitute for product design.
Every adopted component must look and behave as one part of Ironkeep.
