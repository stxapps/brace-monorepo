## legacy Brace.to → Bracemark

A decision record, not a design doc. It owns **how the ~100 paying users of the
legacy Stacks-based Brace.to get their data into this repo's app**, and how the
legacy product is wound down.

Its sibling, [brand.md](./brand.md), owns the other half of the v1 transition:
what this app is called. The two are constantly confused for each other and are
in fact **independent** — renaming does not remove one line of migration work;
migrating does not require a rename. That is why they are two files.

Deliberately **not** called `migration.md` — "migration" in this workspace means
the schema-migration tripwire (_Greenfield — no migrations_ in `CLAUDE.md`),
which is a different and unrelated rule that still holds. Nothing here
reintroduces persisted-schema migrations.

Companions: [business-model.md](./business-model.md) for the pricing this
grandfathering is measured against, [iap.md](./iap.md) for the entitlement
mechanism, [data-lifecycle.md](./data-lifecycle.md) for the importer this plan
extends, [account.md](./account.md) for why the two identity models can't be
bridged, [brand.md](./brand.md) for the name and the domain estate.

### what "v1" is

Legacy Brace.to is live and actively maintained. It is **not** an abandoned
codebase — this materially changes the plan, because shipping one more release to
it is a normal release week rather than toolchain archaeology.

| property                             | where                                | repo                                           |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| web app                              | `https://brace.to` (the apex)        | `../brace-client/packages/next/`               |
| iOS / Android apps                   | App Store / Play (`com.bracedotto`)  | `../brace-client/packages/expo/`               |
| Chrome / Firefox / Safari extensions | three separate listings              | `../brace-extensions/{chrome,firefox,safari}/` |
| data server (Gaia hub)               | `https://hub.stacksdrive.com`        | `../sdrive-hub/`                               |
| link preview server                  | `https://brace-001.uc.r.appspot.com` | `../brace-server/`                             |
| IAP server                           | `https://iap-001.uc.r.appspot.com`   | `../iap-server/`                               |
| docs site                            | `https://docs.brace.to`              | `../brace-docs/`                               |

`../brace-client/packages/expo/package.json` pins **Expo SDK 54, React Native
0.81.5, React 19.1** — the same generation as this repo. v1 releases are cheap.

v1 hardcodes the apex in exactly two places that matter for a domain move:
`../brace-client/packages/expo/src/types/const.ts:1` (`DOMAIN_NAME`) and
`../brace-extensions/chrome/js/background.js:14`. Moving the v1 web app also
invalidates its Stacks auth redirect URIs.

### the migration bridge is one parser

This is the whole of it. The complexity people imagine here lives entirely in the
_things not to build_ section below.

**What v1 exports** (`../brace-client/packages/next/src/actions/data.ts:844`): a
file named `Brace.to data <timestamp>.txt` whose contents are
`JSON.stringify([{ path, data }, …])` — a flat dump of Gaia file paths and their
**decrypted** contents. Lists are encoded in the path (`links/{listName}/…`);
pins, tags and settings ride along; images are inlined as base64 data URLs.

**What this repo imports today**
(`packages/shared/src/import/detect.ts:23`, `parse.ts:19`): the v2 zip bundle,
Netscape HTML, Raindrop CSV, and plain URL text. There is no v1 branch.

**The work**, therefore:

1. `packages/shared/src/import/brace-v1.ts`, modelled on the existing
   `netscape.ts` / `csv.ts` — same `ImportedLink[]` return shape.
2. A detect branch: a JSON array whose elements carry `path` / `data` keys.
   Detection is content-first, filename only breaks ties (`detect.ts` header).
3. One dispatch line in `parse.ts`.

The list/tag find-or-create walks in `import/resolve.ts` already do the rest —
v1's `listName` maps onto v2's `listId` through exactly the resolver that
Netscape folders already use.

Two snags worth deciding up front:

- **Images and the quota gate.** v1 inlines images as base64 data URLs, and the
  v2 import lands through the write edge behind `maxLinks` and the `files/sign`
  byte quota (see [data-lifecycle.md](./data-lifecycle.md) — the import fails
  _before anything is written_ if it would pass the gate). A heavy v1 user can
  fail on image bytes alone. **Recommended: drop images on v1 import** and let
  extraction re-fetch them — the preview image is free for every tier (see
  [business-model.md](./business-model.md)), so nothing is lost but time.
- **Pins.** v1 has them and they are not part of the shared `ImportedLink` shape
  the other parsers produce. v2 keeps pins in their own LWW-isolated `pins/` file
  (see the rationale in `packages/shared/src/sync/entities.ts` around the
  `linkSchema` comment). Map them explicitly or they are silently dropped.

### entitlements — the ~100 paying users

No system required. [iap.md](./iap.md) line ~441 already defines
`source: 'manual'` for comps and lifetime grants as non-expiring rows. Migrating
the paid cohort is ~100 row inserts, an afternoon of ops.

On price: legacy is **$4.99/yr**; this repo's `PLAN_USD_PER_YEAR` puts pro at
**$48/yr** (`packages/shared/src/iap/plans.ts`). Grandfathering $4.99
**forever** is **rejected** — a permanent two-tier population means an awkward
conversation at every paid gate, indefinitely. Grant the legacy price with a
**stated end date** (2–3 years) in the migration email instead. "Your price is
locked through 2029" lands very differently from a silent 10× reset, and it
terminates.

### what not to build

Everything expensive is here, and none of it is necessary:

- Automatic account migration.
- Re-deriving v2 keys (Argon2id passphrase) from a v1 Stacks seed phrase. The
  identity models are incompatible **by design** — see [account.md](./account.md).
- Dual-writing to both backends.
- Entitlement sync between the legacy `iap-server` and this repo's IAP path.

v1 and v2 are two separate products that share a name and an export format. The
user clicks Export in v1, clicks Import in v2, and the paid cohort gets a manual
grant. That is the entire bridge.

### phasing — keep legacy work off the launch critical path

The single thing that makes this transition feel complex is legacy releases
blocking the v2 launch. Sequenced this way, none of them do. The v2 column is
the fixed backdrop — the rename work it assumes is in
[brand.md](./brand.md#the-rename-is-outstanding-work-in-this-repo), and it must
be finished before phase 1 ships, because store submission locks the bundle ID.

| phase                      | v2                                                           | v1                                                                                                                      |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **1 — launch**             | ships to `app.bracemark.com`; new store + extension listings | **untouched.** Stays at `brace.to`. No releases, no renames, no review cycles                                           |
| **2 — after v2 is stable** | apex `bracemark.com` serves marketing                        | one release: migration banner, `DOMAIN_NAME` + `background.js` repointed to `v1.brace.to`, Stacks redirect URIs updated |
| **3 — wind-down**          | —                                                            | unlist all listings; announce and hold a sunset date                                                                    |

Phase 1 is possible because this repo already puts the app at a subdomain and
treats the apex as a separate marketing property
([deployment.md](./deployment.md)) — so v2 never contends with v1 for a hostname.

Do **not** let the old infrastructure "age out naturally". That means paying for
three GCP App Engine services (`sdrive-hub`, `brace-server`, `iap-server`) plus
their maintenance indefinitely. Pick a date, announce it, hold it.

### stores and extensions — what actually needs a build

Most of what looks like store work isn't. Only one row below requires shipping a
binary:

| goal                               | how                                                           | build?  |
| ---------------------------------- | ------------------------------------------------------------- | ------- |
| v2 listing doesn't collide with v1 | v2 is named _Bracemark_ — no collision at all                 | no      |
| stop new v1 signups                | **server-side in `sdrive-hub`** — you own it                  | no      |
| stop new v1 subscriptions          | **server-side in `iap-server`**                               | no      |
| hide v1 from search                | unlist / remove-from-sale — a dashboard toggle on every store | no      |
| migration banner inside v1         | a v1 release across expo + 3 extensions + web                 | **yes** |

The general rule: **anything you want to change about v1's behaviour, do it
server-side.** Disabling account creation by shipping a client update is the
expensive way to do something achievable in an afternoon, reversibly, with no
review queue.

Renaming the v1 listings to something like "Brace Legacy" is only partially
worth it: with v2 named _Bracemark_ there is no name collision to resolve, so
renaming buys clarity, not necessity. In particular **do not rename the Safari
extension** — it launched recently (App Store id `6755517805`), and a
months-old listing relabelled "deprecated" reads as abandonment. Unlist it or
leave it alone.

v2 gets brand-new listings on every store regardless of naming, because the
bundle ID changes — so nothing carries over from the v1 listings except the
developer accounts and the ability to cross-promote from them. That consequence
belongs to the rename; it is spelled out in
[brand.md](./brand.md#the-rename-is-outstanding-work-in-this-repo).

### open decisions

- Final grandfathering window for the legacy cohort (2 years? 3?).
- Whether the docs site moves to `docs.bracemark.com` in phase 1 or phase 2.
- Whether v1's images are dropped on import (recommended) or counted against
  quota.
