## safe area, viewport & insets

How brace apps deal with notches/rounded corners (safe-area insets), scrollbar
width, and viewport sizing — and the gotchas that make these disagree. The web
helpers live in `@stxapps/web-ui` (web-only); the last two sections cover the
brace-expo side (native safe area and the keyboard). See
[architecture.md](./architecture.md) for layering.

### the core problem: "width" is not one number

Three viewport widths exist and they disagree, by design:

| value                         | scrollbar? | safe area?                     | notes                     |
| ----------------------------- | ---------- | ------------------------------ | ------------------------- |
| CSS `@media` / Tailwind `md:` | included   | full viewport                  | what a breakpoint matches |
| `window.innerWidth`           | included   | full viewport                  | —                         |
| `documentElement.clientWidth` | excluded   | full viewport                  | layout width              |
| `visualViewport.width`        | excluded   | reflects pinch-zoom / keyboard | best for popups           |

Consequence: if you measure a width in JS and re-derive "am I at `md`?", you can
disagree with what Tailwind actually matched — by the scrollbar width. **Never
re-derive breakpoints from a measured width.** Use the same media query the CSS
uses (see `useMediaQuery` below).

### the three kinds of zoom

Three different "zooms" reach the UI through different channels. They are not
interchangeable, and only two of them are ours to handle.

| zoom                                          | how it's triggered              | what we do                                                                                          |
| --------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| **browser zoom** (Cmd/Ctrl +/−)               | full-page scale                 | nothing — browser scales `px`/`rem`/images/borders proportionally; layout never sees it             |
| **default font size** (browser/OS preference) | changes what `1rem` resolves to | author in `rem` so the UI scales as one block                                                       |
| **pinch-zoom** (touch)                        | gesture                         | enable/disable via meta viewport only; size popups against `visualViewport` so they follow the user |

**Browser zoom** needs no code. It scales rendered output uniformly and does not
change the root font size.

**Default font size** is why we author in `rem`. When the user's preferred size
grows (16px → e.g. 20px), `1rem` grows, and because Tailwind expresses spacing,
sizing, and radius in rem (not just `text-*`), the whole UI scales together and
keeps its proportions. In custom components, use `rem`; avoid hand-computed px
widths/heights/spacing.

rem-everywhere is a deliberate accessibility trade-off, **not** an absolute rule.
Some things should _not_ track the user's font preference and stay in **px** — and
Tailwind's own defaults already draw this line for you:

| scale with font size → `rem`                      | keep device-fixed → `px`                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text, padding/margin/gap, component & icon sizing | borders, `divide`, `ring`, `outline` (Tailwind defaults these to px), hairlines, 1px shadows, image intrinsic sizes, safe-area insets (`env()` returns px) |

The bug to avoid is the **half-scaled** UI: rem text inside a px-fixed container (or
vice versa) clips when the font size grows. Either let a region scale as a whole, or
keep it fixed as a whole.

**Pinch-zoom** can only be enabled/disabled through `<meta name="viewport">`
(`user-scalable=no`, `maximum-scale=1`) — and WebKit ignores that for accessibility,
so you can't fully suppress it on iOS. You can't react to the gesture itself, but it
_does_ move the **visual** viewport: `visualViewport.width/height` shrink and
`offsetLeft/offsetTop/scale` change. So anything sized against `useVisualViewport`
(hand-rolled popups, see below) follows the user into the zoomed region — which is
the desired behavior. `useWindowSize` (layout viewport) is unaffected by pinch-zoom,
which is exactly why breakpoint logic uses it. See the width table above
(`visualViewport.width` is the pinch-zoom-aware row) and `useWindowSize` vs
`useVisualViewport` below.

### prerequisite: `viewport-fit=cover`

`env(safe-area-inset-*)` are **all 0** unless the page opts into edge-to-edge with
`viewport-fit=cover`. In `brace-web` this is set in `src/app/layout.tsx`:

```ts
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', … };
```

Without it, none of the `safe-area` utilities or `useWindowInsets` do anything.

### what's provided

**CSS** (`@stxapps/web-ui/styles.css`)

- `scrollbar-gutter: stable` on `html` — reserves the scrollbar gutter so its
  width is constant; layout stops shifting and JS width math stays in sync with
  CSS breakpoints.
- `@utility safe-area` — pads all four sides with the insets.
- `@utility pt-safe / pr-safe / pb-safe / pl-safe` — per-side variants to mix with
  normal spacing.
- `--env-safe-area-inset-*` custom-property tokens. **Do not read these back via
  `getComputedStyle`** — several browsers (Safari included) return the literal
  `env(...)` string. Use `getWindowInsets()` instead, which measures a probe
  element's resolved padding.

**Utils** (`@stxapps/web-ui/lib/window`)

- `getWindowInsets(): Insets` — safe-area insets in px (probe-element based,
  SSR-safe → zeros). One-shot; not reactive.
- `getScrollbarWidth(): number` — `innerWidth - clientWidth`, 0 for overlay
  scrollbars.

**Hooks** (`@stxapps/web-ui/hooks/use-media-query`, `…/use-window-metrics`)

- `useMediaQuery(query)` — SSR-safe `matchMedia` subscription. Pass the _same_
  string Tailwind uses, e.g. `'(min-width: 48rem)'` for `md:`.
- `useWindowInsets()`, `useWindowSize()`, `useVisualViewport()`,
  `useScrollbarWidth()` — reactive, backed by **one shared store**: a single
  subscription and a single DOM read per event regardless of how many components
  call them, with per-slice reference stability so a component only re-renders
  when the value it reads changes.

`useWindowSize` vs `useVisualViewport`: the former is the **layout** viewport
(`innerWidth/innerHeight`, scrollbar included, matches CSS breakpoints, _unaffected
by zoom or the on-screen keyboard_) — use it for breakpoint-aligned logic. The
latter is the **visual** viewport (the visible region after pinch-zoom and the soft
keyboard, with `offsetLeft/offsetTop/scale`) — use it to size/position popups so
they clear the keyboard. On most mobile browsers the keyboard fires only
`visualViewport.resize`, not `window.resize`, so layout size won't even reflect it.

### applying safe area

A blanket `<div className="safe-area">` (as in `brace-web` `inner-layout.tsx`) is
the right default: padding paints _inside_ the box, so a background fills
edge-to-edge under the notch while content is inset. It does inset **all** children
uniformly, though — once you add a sticky header or bottom bar that should bleed to
the edge with only its _contents_ inset, drop the blanket utility and apply per-side
utilities where they belong (`pt-safe` header, `pb-safe` bottom bar, `px-safe` side
content).

### breakpoints vs. insets

Left/right insets that shrink usable width are almost always 0 in portrait — they
appear mainly in landscape (side notch) or with rounded display corners. Top/bottom
insets reduce height, not width. So a layout can match `md:` yet have ~16–32px less
content width in landscape. Keep it in mind for layouts that are tight at a
breakpoint edge; if it actually breaks, size that region with a **container query**
(`@container`) so it responds to its own post-inset width, rather than fighting the
breakpoint math.

### popups & dialogs

1. **Prefer shadcn/Radix** (`Dialog`, `Popover`, `DropdownMenu`, `Tooltip`,
   `HoverCard`). They handle portalling, focus trap, a11y, and collision/flip/shift
   via Floating UI. Keep them out of the unsafe area by feeding insets:

   ```tsx
   const insets = useWindowInsets();
   <PopoverContent collisionPadding={insets} />;
   ```

2. **Hand-roll only when Radix can't express the UI** (custom anchored panel,
   coordinate-driven menu). Size against `visualViewport` (keyboard/pinch-zoom
   aware) minus insets:

   ```ts
   const vv = useVisualViewport(); // keyboard / pinch-zoom aware
   const inset = useWindowInsets();
   const availW = vv.width - inset.left - inset.right;
   const availH = vv.height - inset.top - inset.bottom;
   // position within the visible region: add vv.offsetLeft / vv.offsetTop
   ```

   (`useVisualViewport` already excludes the scrollbar and reflects zoom, so you
   don't subtract `useScrollbarWidth()` here — that's for layout-viewport math.)

### performance note

`useMediaQuery` is cheap to use per-component: `change` fires only at the breakpoint
boundary and does no layout work. Anything that calls `getComputedStyle` /
`getBoundingClientRect` (like `getWindowInsets`) forces a reflow, so those are
funneled through the single shared store in `use-window-metrics.ts` — one
measurement per event for the whole app. Follow the same rule for any future
"global truth" input (scroll position, etc.): hoist it into one shared
`useSyncExternalStore`, don't let every component subscribe and measure
independently.

### safe area on native (brace-expo)

The same notch/home-indicator problem, but the mechanics differ from web: there
is no `env()`/CSS cascade — insets come from **react-native-safe-area-context**,
and both apps' surfaces are edge-to-edge by default (iOS always was; Android
15+ enforces it), so every screen must handle them.

- **Provider: already there — don't add one.** expo-router's
  NavigationContainer mounts react-navigation's `SafeAreaProviderCompat`, so
  screens can use `SafeAreaView`/`useSafeAreaInsets` with **no explicit
  `SafeAreaProvider` in `_layout.tsx`** (see its header comment). The one tree
  outside any provider is the share sheet — `share-screen.tsx` uses no
  safe-area API at all: the iOS host sheet is positioned by the system, and
  Android's bottom sheet + backdrop fill the window by design.
- **Screens: `SafeAreaView` from `react-native-safe-area-context`** (never the
  deprecated RN-core one), wrapped once per file as
  `const StyledSafeAreaView = withUniwind(SafeAreaView)` so it accepts
  `className` — it's a composite component, not a core host like `View`/`Text`
  (the note in `components/landing.tsx`). The standard shape is
  `<StyledSafeAreaView className="bg-background flex-1">` around the screen:
  padding paints inside the box, so the background fills edge-to-edge under
  the notch while content is inset — the native mirror of web's blanket
  `safe-area` div, with the same caveat: once a bar should bleed to the edge
  with only its contents inset, switch to the `edges` prop / per-side inset
  styles.
- **Why the native `SafeAreaView` and not `useSafeAreaInsets` + padding:** it
  measures **its own** insets natively, per window and per container — inside
  the AdvancedSearch `Modal` it correctly supplies the status-bar inset on
  Android's full-screen modal and near-zero top inset inside iOS's pageSheet
  (`search-bar.tsx`), with no context reaching across the Modal's window
  boundary and no first-frame flash. Reach for `useSafeAreaInsets()` only when
  you need the numbers (e.g. as a prop, below).
- **Portaled content does NOT inherit screen insets.** `Dialog`/`AlertDialog`/
  `DropdownMenu` content portals to the root `PortalHost` (wrapped in
  react-native-screens' `FullWindowOverlay` on iOS) — outside every screen's
  `SafeAreaView`. It's safe by different means:
  - **Centered dialogs** (`ui/dialog.tsx`, `ui/alert-dialog.tsx`): the overlay
    is `absoluteFill` + centered with padding; centered content never reaches
    the unsafe edges, so no inset work.
  - **Anchored menus** (`ui/dropdown-menu.tsx`): @rn-primitives positions
    against the measured trigger with `avoidCollisions` (default on); its
    `insets` prop is the extra collision padding — the native analogue of
    Radix's `collisionPadding` (rule 1 in _popups & dialogs_ above). Current
    triggers all sit inside safe-area'd chrome, so nothing passes it yet; a
    trigger near a raw screen edge should pass
    `insets={useSafeAreaInsets()}`.
  - **Hand-rolled absolute positioning** (a future toast, a bottom bar in an
    overlay): nothing inherits — apply `useSafeAreaInsets()` offsets yourself,
    the native mirror of web's hand-rolled rule 2.

### keyboard avoidance on native (brace-expo)

On web the keyboard is a viewport concern (`visualViewport` shrinks — see
above). On native the keyboard **overlays** the window on both platforms —
with edge-to-edge (enforced on Android 15+) `adjustResize` no longer resizes,
so Android behaves like iOS — and content must move itself. Two mechanisms
exist, and **the presentation container decides which, not the feature**:

| surface                                                       | mechanism                                                           | examples                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| regular expo-router screen                                    | keyboard-controller `KeyboardAwareScrollView` in the screen wrapper | `auth-screen.tsx`, `settings/[section].tsx` |
| RN `Modal`                                                    | plain `KeyboardAvoidingView behavior="padding"`                     | AdvancedSearch (`links/search-bar.tsx`)     |
| share sheet (iOS extension process / Android `ShareActivity`) | plain `KeyboardAvoidingView` — keyboard-controller cannot work here | `share/share-screen.tsx` `Sheet`            |

- **The default is react-native-keyboard-controller.** Its `KeyboardProvider`
  mounts once at the root (`src/app/_layout.tsx`) and feeds
  WindowInsetsAnimation-synced keyboard values; screens consume them via
  `KeyboardAwareScrollView` (wrapped with `withUniwind` for `className`).
- **The unit of handling is the screen/scroll container, not the leaf.**
  Components rendered inside an already-keyboard-aware screen — the settings
  sections (`lists-section.tsx`, `tags-section.tsx`), future
  `ListSelect`/`TagsField` cousins — declare nothing themselves. Don't nest a
  second avoider; two stacked avoiders double the offset.
- **Why RN `Modal` opts out:** a `Modal` is its own native window. React
  context technically crosses the boundary, but the provider's native
  `KeyboardControllerView` doesn't wrap the modal's window, so its animated
  values can't drive content there. Hence plain
  `KeyboardAvoidingView behavior="padding"` inside the Modal (AdvancedSearch's
  in-file comment carries the local rationale).
- **Why the share sheet can't use it at all** (the stronger constraint):
  keyboard-controller's iOS layer is built on `UIApplication.shared`, which
  doesn't exist in an app-extension process — expo-share-extension's
  `APPLICATION_EXTENSION_API_ONLY=No` only makes such pods compile, not work.
  Even nesting a fresh `KeyboardProvider` wouldn't help. Android's
  `ShareActivity` could technically differ, but one plain KAV keeps the two
  hosts rendering the same tree (docs/share-sheet.md).
- **For a new surface, decide the presentation first; the keyboard answer
  follows.** A future link-add/link-edit built as a router screen inherits the
  keyboard-controller path for free; built as a page-sheet `Modal` (like
  AdvancedSearch), it must carry its own plain `KeyboardAvoidingView`.
