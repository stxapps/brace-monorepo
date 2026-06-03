## safe area, viewport & insets

How brace apps deal with notches/rounded corners (safe-area insets), scrollbar
width, and viewport sizing — and the gotchas that make these disagree. Lives in
`@stxapps/web-ui` (web-only). See [architecture.md](./architecture.md) for layering.

### the core problem: "width" is not one number

Three viewport widths exist and they disagree, by design:

| value | scrollbar? | safe area? | notes |
| ----- | ---------- | ---------- | ----- |
| CSS `@media` / Tailwind `md:` | included | full viewport | what a breakpoint matches |
| `window.innerWidth` | included | full viewport | — |
| `documentElement.clientWidth` | excluded | full viewport | layout width |
| `visualViewport.width` | excluded | reflects pinch-zoom / keyboard | best for popups |

Consequence: if you measure a width in JS and re-derive "am I at `md`?", you can
disagree with what Tailwind actually matched — by the scrollbar width. **Never
re-derive breakpoints from a measured width.** Use the same media query the CSS
uses (see `useMediaQuery` below).

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

**Utils** (`@stxapps/web-ui/lib/utils`)

- `getWindowInsets(): Insets` — safe-area insets in px (probe-element based,
  SSR-safe → zeros). One-shot; not reactive.
- `getScrollbarWidth(): number` — `innerWidth - clientWidth`, 0 for overlay
  scrollbars.

**Hooks** (`@stxapps/web-ui/hooks/use-media-query`, `…/use-window-metrics`)

- `useMediaQuery(query)` — SSR-safe `matchMedia` subscription. Pass the *same*
  string Tailwind uses, e.g. `'(min-width: 48rem)'` for `md:`.
- `useWindowInsets()`, `useWindowSize()`, `useVisualViewport()`,
  `useScrollbarWidth()` — reactive, backed by **one shared store**: a single
  subscription and a single DOM read per event regardless of how many components
  call them, with per-slice reference stability so a component only re-renders
  when the value it reads changes.

`useWindowSize` vs `useVisualViewport`: the former is the **layout** viewport
(`innerWidth/innerHeight`, scrollbar included, matches CSS breakpoints, *unaffected
by zoom or the on-screen keyboard*) — use it for breakpoint-aligned logic. The
latter is the **visual** viewport (the visible region after pinch-zoom and the soft
keyboard, with `offsetLeft/offsetTop/scale`) — use it to size/position popups so
they clear the keyboard. On most mobile browsers the keyboard fires only
`visualViewport.resize`, not `window.resize`, so layout size won't even reflect it.

### applying safe area

A blanket `<div className="safe-area">` (as in `brace-web` `inner-layout.tsx`) is
the right default: padding paints *inside* the box, so a background fills
edge-to-edge under the notch while content is inset. It does inset **all** children
uniformly, though — once you add a sticky header or bottom bar that should bleed to
the edge with only its *contents* inset, drop the blanket utility and apply per-side
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
   <PopoverContent collisionPadding={insets} />
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
