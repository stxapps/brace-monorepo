## extension

Notes on the `brace-extension` (wxt) app and how its UI/logic relates to
`brace-web`. See [architecture.md](./architecture.md) for the package layering
and dependency rules, and [account.md](./account.md) for the
password-derived account model the auth flows build on.

### auth code: shared via packages, not the web app

The reusable substance of the auth flows already lives in the packages, not in
`brace-web`:

- form logic — `useCreateAccountForm`, `useSignInForm`, `useUsernameAvailable`
  in `@stxapps/react`
- schemas + endpoint descriptors in `@stxapps/shared`
- KDF / signing / AES in `@stxapps/web-crypto`
- inputs / buttons / fields in `@stxapps/web-ui`

So when the extension grows its own auth UI, it composes those packages the same
way brace-web does — it does **not** import anything from `brace-web` (apps never
import apps).

### the extension runs its own sign-in — it does not inherit the web session

The non-extractable `encryptionKey` (AES-256-GCM `CryptoKey`) can't cross the
web↔extension boundary: it lives in brace-web's IndexedDB on the `app.brace.to`
origin, and the extension runs on a separate `chrome-extension://` origin. So
the extension unlocks **on its own** — its own sign-in, deriving its own keys
from (username, password) via `@stxapps/web-crypto` — rather than reading the
web app's session. (This supersedes an earlier idea that the extension would
inherit the session out of shared storage.)

### decision (2026-06-23): the move happened — the auth glue (and the whole local-first stack) now lives in the packages

brace-extension's auth work has begun, so the trigger below fired. The auth
glue — and the rest of the shared local-first stack (data layer, sync engine,
sync/auth providers, editor hooks) — moved out of `apps/brace-web` into the
packages, with brace-web re-importing from them (single source of truth):

- `create-account-form.tsx`, `sign-in-form.tsx` →
  `@stxapps/web-ui/components/auth/*`
- `use-create-account.ts` / `use-sign-in.ts` / `use-sign-out.ts`,
  `auth-provider.tsx`, `sync-provider.tsx`, `session-store.ts`, the `data/*`
  store + the `sync/*` engine, and the `(app)/_hooks` editor family →
  `@stxapps/web-react` (see [architecture.md](./architecture.md)).

The inversion the move required: the two auth submit hooks and the sync engine
no longer reach for brace-web's app-local `@/lib/api`. They read the configured
client through the `@stxapps/react` seam — `useApiClient()` in the hooks,
`SyncDeps.api` (threaded from the provider) in the engine — so each app binds
its own baseUrl. brace-web's `lib/api.ts` stays app-local (it owns
`NEXT_PUBLIC_API_URL`); the extension's `utils/api.ts` is its counterpart
(base URL from the build mode).

The original "move later" reasoning is kept below for the record.

---

The decision (2026-06-08) had been to keep these five files app-local until
brace-extension's auth work actually started:

- `app/(auth)/create-account/create-account-form.tsx`
- `app/(auth)/create-account/use-create-account.ts`
- `app/(auth)/sign-in/sign-in-form.tsx`
- `contexts/auth-provider.tsx`
- `data/session-store.ts`

**Why move later, not now (the reasoning at the time):**

- They're **thin app glue**, not reusable logic — the heavy, genuinely-shared
  parts are already in the packages listed above. There's little "design for
  sharing" left to capture.
- `use-create-account.ts` couples to the app-local `@/lib/api` instance
  (per-app, env-configured base URL) and `@/contexts/auth-provider`. Sharing it
  means inverting those dependencies — and the right shape for that inversion is
  driven by the extension's real api-config and provider tree, which don't exist
  yet. Freezing the interface against a single consumer is premature abstraction:
  design it now, redesign + re-test both apps later.
- `sign-in-form.tsx`'s `onSubmit` is still a stub (the KDF→sign→session sequence
  isn't written). Finish the flow once in brace-web before sharing it, rather
  than share → finish → re-verify two apps.
- Cost is asymmetric: moving later is a mechanical `git mv` + import fixups;
  moving now-wrong is a double refactor plus a double re-test.

**To keep "later" cheap (free, do it as you go):** keep these files
Next-agnostic — no `next/navigation`, `next/image`, `server-only`, or RSC-only
assumptions. They already are (`'use client'` is a harmless no-op under
wxt/Vite, and `session-store.ts` is pure IndexedDB with zero app deps).

**The trigger to move:** when brace-extension's auth work begins and its
api-config + provider shape exist — then there are two real consumers to
validate the interface against. Destinations:

- `create-account-form.tsx`, `sign-in-form.tsx` → `@stxapps/web-ui`
- `use-create-account.ts`, `auth-provider.tsx`, `session-store.ts` →
  `@stxapps/web-react`

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
