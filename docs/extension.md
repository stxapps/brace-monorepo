## extension

Notes on the `brace-extension` (wxt) app and how its UI/logic relates to
`brace-web`. See [architecture.md](./architecture.md) for the package layering
and dependency rules, and [account.md](./account.md) for the
password-derived account model the auth flows build on.

### wxt conventions

- **Use `browser.*` from wxt, not raw `chrome.*`.** wxt's `browser` namespace is
  Promise-based and cross-browser, so you don't hand-write callback wrappers or
  per-browser branches. Reach for `chrome.*` directly only for a Chrome-specific
  API with no standard equivalent (rare).
- **Entrypoints map to extension contexts.** wxt's `entrypoints/` directory is the
  contract: `background.ts` → the MV3 service worker; `popup/` → the quick-save +
  recent-list React app; `options/` → account / passphrase / key-management React
  app; `content.ts` → the programmatic content script (active-tab DOM read for the
  active-page extraction tier — see [link-extraction.md](./link-extraction.md)).
- **`brace-extension/utils/` is a WXT-reserved directory name** — don't rename it
  to `lib/` for consistency with the other apps/packages. WXT (like Nuxt) does
  directory-based auto-imports: it scans `utils/` (alongside `components/`,
  `composables/`, `hooks/`, and `entrypoints/`/`public/`/`assets/`) and
  regenerates `.wxt/types/imports-module.d.ts` + `.wxt/eslint-auto-imports.mjs`
  from it. Renaming the folder stops WXT from registering those modules into the
  `#imports` virtual module. `lib/` is our house style only for folders we
  organize freely (`brace-api/src/lib`, `web-react/src/lib`, the packages); the
  framework-reserved names stay as the framework expects.

### storage across extension contexts

The extension has three persistence layers, and which one to use depends on the
context that has to reach the data:

- **`browser.storage.local` / `.session`** — the primary cross-context store.
  Reach for it for state the background worker and the popup both touch, because
  the **popup's lifecycle is short** (it unmounts on close, so its in-memory and
  page-scoped `localStorage` state is fragile), and the **MV3 background service
  worker has no DOM and no `localStorage`** at all. `.session` is
  memory-backed and cleared on browser restart — the right home for ephemeral
  unlocked state.
- **IndexedDB** — for larger structured data and richer local querying (e.g. a
  local encrypted link index for search), available in both popup and background
  contexts. It is also where the extension keeps its **non-extractable
  `encryptionKey` `CryptoKey`** (structured-clone storable; `browser.storage`,
  being JSON-serialized, can't hold a `CryptoKey`) — the same `session-store.ts`
  shape brace-web uses, on the `chrome-extension://` origin. This is consistent
  with the extension deriving and holding its **own** key (see _the extension runs
  its own sign-in_ above).
- **`localStorage`** — technically works in the popup/options pages, but not worth
  relying on given the popup's short lifecycle; prefer `browser.storage`.

### the extension runs its own sign-in — it does not inherit the web session

The non-extractable `encryptionKey` (AES-256-GCM `CryptoKey`) can't cross the
web↔extension boundary: it lives in brace-web's IndexedDB on the `app.brace.to`
origin, and the extension runs on a separate `chrome-extension://` origin. So
the extension unlocks **on its own** — its own sign-in, deriving its own keys
from (username, password) via `@stxapps/web-crypto` — rather than reading the
web app's session. (This supersedes an earlier idea that the extension would
inherit the session out of shared storage.)

### auth code lives in the packages, not the web app

The auth flows and the rest of the shared local-first stack live in the
packages, not in `brace-web` — brace-web re-imports from them (single source of
truth), and the extension composes the same packages, importing **nothing** from
`brace-web` (apps never import apps).

The reusable primitives:

- form logic — `useCreateAccountForm`, `useSignInForm`, `useUsernameAvailable`
  in `@stxapps/react`
- schemas + endpoint descriptors in `@stxapps/shared`
- KDF / signing / AES in `@stxapps/web-crypto`
- inputs / buttons / fields in `@stxapps/web-ui`

The auth glue + local-first stack:

- `create-account-form.tsx`, `sign-in-form.tsx` →
  `@stxapps/web-ui/components/auth/*`
- `use-create-account.ts` / `use-sign-in.ts` / `use-sign-out.ts`,
  `auth-provider.tsx`, `sync-provider.tsx`, `session-store.ts`, the `data/*`
  store + the `sync/*` engine, and the `(app)/_hooks` editor family →
  `@stxapps/web-react` (see [architecture.md](./architecture.md)).

The auth submit hooks and the sync engine don't reach for an app-local
`@/lib/api`. They read the configured client through the `@stxapps/react`
seam — `useApiClient()` in the hooks, `SyncDeps.api` (threaded from the
provider) in the engine — so each app binds its own baseUrl. brace-web's
`lib/api.ts` stays app-local (it owns `NEXT_PUBLIC_API_URL`); the extension's
`utils/api.ts` is its counterpart (base URL from the build mode).
