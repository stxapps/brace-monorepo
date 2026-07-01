## theme

How brace decides whether to render **light or dark**, how the user's choice is
stored, and why `localStorage` stays in the loop even though the choice can sync.
See [local-first-sync.md](./local-first-sync.md) for the encrypted-file data path
the synced half rides on (one entity per `*.enc` blob, file-level LWW, the
`settings/general.enc` file) and the off-sync `localSettings` store the device
half lives in; [client-queries.md](./client-queries.md) for the `useSettings`
read edge this reuses; and [architecture.md](./architecture.md) for the package
layering the pieces sit in.

The theme mirrors the **link-layout** setting one-for-one: same sync/device
split, same two stores, same `useSettings` / `useSettingMutations` seam. If
you've read how `linksLayout` works, you already know the shape — this doc adds
the one thing theme has that layout doesn't: a **pre-paint (FOUC) constraint**
that keeps `localStorage` mandatory.

### the model — four modes, one resolved answer

The user picks one of four **modes**; the DOM only ever needs the resolved
light/dark result. The mode plus two custom-mode times make up a `ThemeState`
(`@stxapps/shared` `theme/theme.ts`):

```ts
type ThemeMode = 'light' | 'dark' | 'system' | 'custom';
interface ThemeState {
  mode: ThemeMode;
  lightStart: string; // "HH:mm" 24h — when light turns on in `custom` mode
  darkStart: string; // "HH:mm" 24h — when dark turns on in `custom` mode
}
```

- `light` / `dark` — pin the theme.
- `system` — follow the OS `prefers-color-scheme`.
- `custom` — light by day, dark by night, on the user's own schedule; the dark
  window may wrap past midnight (e.g. dark `19:00` → light `06:00`).

`DEFAULT_THEME` is `system` with `06:00` / `19:00`.

The resolver is a **pure, platform-agnostic function** so every surface — both
apps and the pre-paint script — agrees on the same answer:

```ts
resolveTheme(state, { now, systemPrefersDark }): 'light' | 'dark';
```

`system`/`custom` need outside facts (the OS preference, the current time), so
the caller supplies them rather than the function reaching for globals. Two
helpers ride alongside it in the same file:

- `msUntilNextThemeSwitch(state, now)` — ms until the next `custom`-mode
  crossover (`null` for every other mode), so a provider can schedule a single
  timer to re-resolve at exactly the right moment.
- `coerceThemeState(value)` — validate/normalize an untrusted value (from storage
  or a synced blob) into a real `ThemeState`, falling back to defaults per field.

### where the choice lives — the sync/device split

Like `linksLayout`, the theme has **two sources**, and a per-device toggle picks
which one applies:

| source     | stored in                              | scope                          |
| ---------- | -------------------------------------- | ------------------------------ |
| **Sync**   | `settings/general.enc` (`theme` field) | all the account's devices      |
| **Device** | `localSettings` row (`theme` field)    | this device only, off-sync     |

The **`themeSource`** flag (`'sync'` \| `'local'`) lives in the device-local
`localSettings` row and decides which one the app renders. It is deliberately
device-local: "use this device's own theme" is a per-device decision that must
not propagate. Theme actually earns the Device option more than layout does —
dark on the laptop at night, light on the phone is a genuinely common want.

Both stores are the SAME ones layout uses:

- **Synced** — `settingsGeneralSchema.theme` in `@stxapps/shared` (`sync/
  entities.ts`), written by `writeSettingsGeneral` + a sync kick, read by
  `readSettingsGeneral`. Optional and permissive (see below).
- **Device** — `LocalSettingsRecord.theme` / `.themeSource` in `@stxapps/
  web-react` (`data/db.ts`), a single-row off-sync Dexie table that never becomes
  an `items` blob, never enqueues a pending op, and is wiped on sign-out.

#### why `settingsGeneralSchema.theme` is permissively typed

`themeStateSchema` is a `z.object` whose three fields are `z.string()`, **not**
`z.enum(THEME_MODES)` or a time regex. This schema parses **persisted bytes**,
and `settings/general.enc` is a **shared** file (`linksLayout`, `serverExtraction`,
and `theme` all live in it). If a strict field rejected a newer client's unknown
`mode` or a malformed time, the WHOLE blob would fail to parse and drop from the
UI — taking `linksLayout`/`serverExtraction` down with the theme. So the schema
parses leniently and the **read edge** (`coerceThemeState`, applied in
`useSettings`) is what validates/normalizes into a real `ThemeState`.

It's a `z.object` rather than the file's usual `looseObject` because theme is a
**closed shape** (only these three fields feed `resolveTheme`), so there are no
unknown sub-keys to round-trip — and `z.object`'s inferred type stays index-
signature-free, so a real `ThemeState` assigns straight into it (a `looseObject`
catchall index signature would not). Forward-compat still holds where it matters:
the PARENT `settingsGeneralSchema` is `looseObject`, so a future client's new
SIBLING setting round-trips. **To grow the theme model, add a field beside
`theme`, don't add sub-keys inside it.**

### the read/apply seam

The write and read sides mirror `linksLayout` exactly, in `@stxapps/web-react`:

- **`useSettings()`** resolves and returns `theme` (the active `ThemeState`,
  `localTheme` when `themeSource === 'local'` else `syncTheme`), plus
  `themeSource`, `syncTheme`, and `localTheme` for the settings UI. Both source
  values pass through `coerceThemeState`. Backed by `useLiveQuery`, so a change on
  either store — a local edit, or a sync landing a new `settings/general.enc` —
  re-renders every consumer.
- **`useSettingMutations()`** exposes `setThemeSource` / `setLocalTheme` (→ the
  device-local `localSettings` store) and `setSyncTheme` (→ `writeSettingsGeneral`
  + a sync kick, so every device honors it).

The **`ThemeProvider`** (`@stxapps/web-ui` `contexts/theme-provider.tsx`) is the
read/apply half. It does NOT own the preference — it consumes the already-resolved
`useSettings().theme` (the way the links page consumes `linksLayout`), turns it
into the `.dark` class on `<html>`, tracks `effectiveTheme` (the rendered
light/dark), and re-resolves on each mode's trigger: `system` → an OS
`prefers-color-scheme` change; `custom` → a single `setTimeout` to the next
crossover. `useTheme()` exposes just `{ effectiveTheme }` — the rendered result;
the preference itself stays a single source of truth in `useSettings().theme`, so
read it there rather than re-exposing it here.

This is a deliberate change from the provider's earlier design, which took an
injected `ThemeStorage` (localStorage for brace-web, `browser.storage.sync` for
the extension). Now both apps route theme through the same data layer, so the
injection seam earned nothing — the provider reads `useSettings` directly.
(`web-ui` may import `web-react`; see the layering table in architecture.md.)

### the FOUC constraint — why localStorage never leaves

A page must set the `.dark` class **before first paint**, or it flashes the wrong
theme. That runs in a synchronous inline `<script>` in `<head>`, **before** React
mounts and **before** IndexedDB can be opened, let alone decrypted. The synced
theme lives encrypted in `settings/general.enc` in IndexedDB — **unreachable at
that moment**. So:

> `localStorage` always holds the currently-effective `ThemeState`, as a
> synchronous pre-paint cache, no matter which source is active.

`ThemeProvider` writes that mirror (`localStorage['brace-theme']`,
`THEME_STORAGE_KEY`) every time the resolved theme changes. The pre-paint script
reads it. In **device** mode the mirror equals the device value; in **sync** mode
it's a warm copy of the synced value. On a cold first load in sync mode the synced
value isn't decrypted yet, so the page paints the mirror (or the default) and
self-corrects once Dexie resolves — unavoidable, and warm on every load after.

The pre-paint script is generated once from **`themeInitScript()`**
(`@stxapps/shared`), a self-contained ES5 IIFE that mirrors `resolveTheme` in
plain JS. Single source, no hand-copied duplicate of the resolver.

### per-app wiring

- **brace-web** — `layout.tsx` inlines `themeInitScript()` in `<head>` as a
  server-rendered `<script>`; `inner-layout.tsx` mounts `<ThemeProvider>` (no
  props) inside the data-layer providers. The theme **picker** is Settings → Misc
  (`misc-section.tsx`): a Sync/Device tab, four mode radios, and two time inputs
  revealed in `custom` mode — the same tab shape as the link-layout section right
  above it.
- **brace-extension** — MV3 pages (popup, options). `wxt.config.ts` injects
  `themeInitScript()` into every page's `<head>` at build time via a Vite
  `transformIndexHtml` plugin (`themeFoucPlugin`) — a deferred module `main.tsx`
  runs AFTER paint, so the FOUC script can't live there; it must be the inline
  classic `<script>`, and generating it from the shared source beats hand-copying
  it into each `index.html`. `providers.tsx` mounts `<ThemeProvider>` (no props).
  The extension applies the account's synced theme but has no picker of its own
  yet — picking happens in brace-web; the extension honors it. Popup and options
  share one origin, so they share both the `localStorage` mirror and the Dexie
  stores.

  The extension no longer uses `browser.storage.sync` for theme at all: cross-
  device sync is the sync engine's job now (`settings/general.enc`), and cross-
  context sharing (popup ↔ options ↔ background) comes free from same-origin
  IndexedDB. The old `utils/theme-storage.ts` adapter is gone.

### extending

- **A new mode** — add it to `THEME_MODES` (`theme/theme.ts`), handle it in
  `resolveTheme` (and `msUntilNextThemeSwitch` if it's time-based), mirror the
  branch in `themeInitScript`'s ES5 IIFE, and add a radio in `misc-section.tsx`.
  `coerceThemeState` accepts any value in `THEME_MODES` automatically.
- **A new theme field** — put it beside `theme` in `settingsGeneralSchema` (a new
  sibling round-trips through the parent `looseObject`), not as a sub-key of
  `theme`. Add it to `ThemeState` + `coerceThemeState`, and to
  `LocalSettingsRecord` if it needs a device variant.
- **A quick toggle** (e.g. a menu button, not the settings picker) — write through
  `useSettingMutations` to the active source; don't reintroduce a writer on the
  provider. Read the preference from `useSettings()`, or the rendered light/dark
  from `useTheme().effectiveTheme`.
