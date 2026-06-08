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

### decision (2026-06-08): keep the auth glue app-local in brace-web for now

These five files stay in `apps/brace-web` until brace-extension's auth work
actually starts:

- `app/(auth)/create-account/create-account-form.tsx`
- `app/(auth)/create-account/use-create-account.ts`
- `app/(auth)/sign-in/sign-in-form.tsx`
- `contexts/auth-provider.tsx`
- `data/session-store.ts`

**Why move later, not now:**

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
