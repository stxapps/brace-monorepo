## link extraction

How brace fills in a saved link's **title, image, read-mode text, screenshot,
and archived page** — the metadata a bare URL doesn't carry. See
[local-first-sync.md](./local-first-sync.md) for the encrypted-file data path
this rides on (one entity per `*.enc` blob, file-level LWW), the `pins/`
precedent for the LWW-isolation move repeated here, and the `links/` vs `files/`
split; [architecture.md](./architecture.md) for package layering;
[extension.md](./extension.md) for the brace-extension auth flow the privileged
client builds on; and [account.md](./account.md) for the data key that protects
every blob written here.

### the shape of the problem

A saved link starts as just a URL. To enrich it you must **fetch the page** (for
title/image/read-mode) or **render it** (for screenshot/archive). Two hard
constraints decide where that can happen:

- **CORS.** A `fetch()` to an arbitrary third-party URL from a web app — main
  thread _or_ a Web Worker, same rules — is blocked for almost every site. The
  browser tab in `brace-web` simply **cannot** retrieve arbitrary page HTML. A
  Web Worker doesn't change this; it only helps with CPU-bound parsing of HTML
  something else already fetched.
- **Rendering.** Screenshots and full archives need a real rendering engine
  (headless browser). A tab can't screenshot a remote URL it isn't displaying.

The contexts that escape CORS are the ones that aren't a web-app `fetch`:

- a **browser extension** with host permissions (background fetch — raw HTML —
  or, on the active tab, the live DOM);
- a **native mobile app** (no CORS on native HTTP; a WebView to render);
- a **server** that fetches on the user's behalf.

So extraction is inherently a **multi-client** concern, and the central design
question is _who does the work_ — which is also a **privacy** question, because
whoever fetches the URL learns the URL.

### the stance: privacy-first, off by default, clients do the work

brace is a **privacy-focused** bookmark manager: the sync server only ever sees
ciphertext (see [local-first-sync.md](./local-first-sync.md) — _the server only
ever sees ciphertext_). Extraction is the one feature that wants to break that,
so the posture is deliberately conservative:

- **Extraction is OFF by default.** A fresh install enriches nothing until the
  user opts in. "We leak as little as possible" is the default, not a setting you
  have to find.
- **The clients do the work, never the sync server.** `brace-api` stays a blind
  sync broker — it never fetches a user's URLs, so it never learns them. All
  extraction runs in clients the user already installed and trusts: the
  **extension** and the (future) **Expo** app.
- **No third-party extraction service.** A separate blind service can't write
  results back under E2E (it has no key), so it could only offer poll-and-hope;
  and it would leak every URL to a new party. Rejected on both privacy and cost.

The accepted cost of "clients only" is spelled out under _the web-only gap_
below. This supersedes any earlier sketch of a `brace-api`-assisted title fetch:
weighed against the privacy stance, having the server fetch URLs — even
transiently, even unstored — is a leak we choose not to take by default.

> **Why not `brace-api` even though Workers _could_ do it?** A Worker `fetch` +
> `HTMLRewriter` would extract title/image cheaply (Workers bill CPU-ms, not
> wall-clock, so awaiting a slow remote site is mostly un-billed I/O — cost is a
> non-issue), and "synchronous endpoint" need not block the UI (fire-and-forget
> after the save, patch the title in when it lands). So the blocker is **not**
> latency or cost — it's that the server would see the URL. We keep that option
> documented but **deferred**; if it's ever revived it must be its own explicit,
> second opt-in, distinct from client extraction — and a **separate app/origin**
> from the blind sync broker, never a route in `brace-api` — because its privacy
> profile is strictly worse. See _server extraction (deferred)_.

### capability tiers — not every client can do every job

Fetching a URL is easy wherever there's no CORS; **screenshots and archives are
the hard part, and only an _active page context_ does them well.** This
asymmetry drives the whole result/queue design.

| client / mode                           | title + image | read mode     | screenshot             | archive |
| --------------------------------------- | ------------- | ------------- | ---------------------- | ------- |
| extension — **icon click, active tab**  | ✅ live DOM   | ✅ live DOM   | ✅ `captureVisibleTab` | ✅      |
| extension — **background, queued URL**  | ✅ raw HTML   | ⚠️ raw HTML   | ❌ no open tab         | ⚠️      |
| mobile — **share sheet (foreground)**   | ✅            | ✅ WebView    | ⚠️ WebView render      | ⚠️      |
| mobile — **background queue**           | ✅            | ⚠️            | ❌                     | ❌      |
| `brace-extractor` Worker (**deferred**) | ✅            | ✅ (linkedom) | ❌ needs Browser Rndr. | ❌      |
| third-party service (**rejected**)      | ✅            | ✅            | ✅                     | ✅      |

Two consequences baked into the design:

- **Background queue processing is metadata + read-mode only.** A queued URL has
  no open tab, so it can't be screenshotted without opening one (heavy, flaky).
  On MV3 the extension background is an **ephemeral service worker** — it's
  killed between events, so the queue is driven off `chrome.alarms`, not a
  long-running loop. On mobile, background time is a few unreliable seconds. So:
  **screenshot/archive are best-effort, captured only from the active context**
  (icon click / foreground share). Don't fight the platforms to background them.
- A link extracted at a **low tier** (background raw-HTML, no screenshot) should
  be **upgradable** when a **higher-tier** client later sees it — which means the
  system must record _which tier_ produced the current result. See
  _the extraction entity_.

### the data model: result in `links`, bookkeeping in `extractions/`

There are two kinds of state, and conflating them is the trap:

1. **Display result** — the title/image the UI renders, the heavy refs it opens.
   Written **once** on completion. Belongs in `links/{id}.enc`, the always-resident
   list-view blob, so the library renders offline and the UI never has to join a
   second file to draw a row. The title lands in `links.title`; the preview image
   lands in `links.imageId` (a `files/{id}.enc` ref — heavy media, never inlined).
   Other heavy outputs (screenshot, archived page) stay in `files/{id}.enc`
   referenced by id too, exactly as `pageArchiveId` already is. Where the user has
   set a **manual override**, it sits beside these in the same blob
   (`customTitle` / `customImageId`) and the UI prefers it — see _manual overrides_.
2. **Coordination + provenance** — who extracted, when, at what quality, whether
   it's claimed, whether it failed and when to retry. This is **churny,
   automated** state written by background actors on a different schedule than
   user edits.

Putting (2) in `links` would repeat the mistake the `pins/` design exists to
avoid: a churny `pending → claimed → done/failed` field rewriting the link blob
clobbers a concurrent user title/tag edit under file-level LWW, and bloats the
`< ~2 KB` metadata budget. By the same reasoning that gives pins their own file,
**coordination state gets its own LWW-isolated file, `extractions/{id}.enc`,
shadowing `links/{id}.enc`** (`{id}` = the link's id), one file per link.

The split keeps **one source of truth for the title** (it lives only in `links`,
never copied into `extractions/`); `extractions/` answers only "who/when/quality/
retry?", which `links` deliberately doesn't carry.

> **The one residual cost.** Completing an extraction writes _two_ files: the
> `links` title/image backfill _and_ the `extractions/` bookkeeping. The `links`
> write is a read-merge-write, so it has the usual small LWW clobber window
> against a concurrent user title edit (see [local-first-sync.md](./local-first-sync.md)
> — _conflict policy_). Bounded, one-time (not churny), and acceptable for a
> single-user app — the same tradeoff every backfill write makes.

### manual overrides: `customTitle` / `customImageId`

A user can manually set a link's title and image. The override is a **pair of
optional fields on `linkSchema`** — `customTitle` and `customImageId` (a
`files/{id}.enc` ref to a user-picked image) — **not a new entity**, and that
placement is the deliberate inverse of the `pins/`/`extractions/` split:

- `pins/` and `extractions/` get their own LWW-isolated files because they hold
  **churny, automated** state that would clobber concurrent user edits if it lived
  in the link blob.
- A manual override is the **opposite**: a low-frequency edit a user makes in the
  same gesture as editing `title`/`tagIds`/`listId`, so it belongs **in the same
  file**, beside them. A separate `customTitle/{id}.enc` would force one user edit
  to write two files and race them under file-level LWW — manufacturing the very
  problem the isolated files exist to avoid, for state that doesn't need it.

**Two fields, not one, so extraction and the user never collide on a field.** The
two halves split cleanly by writer:

- **extraction owns `title` / `imageId`** — the discovered/provisional values. It
  writes them unconditionally on completion or tier-upgrade, and **never reads or
  writes the `custom*` fields**.
- **the user owns `customTitle` / `customImageId`** — written only by the explicit
  "edit title/image" action.

The UI renders **`customTitle ?? title`** and **`customImageId ?? imageId`**, so a
manual edit always wins. Three properties fall out for free:

- **Re-extraction is safe.** A higher-tier client re-extracting `titleImage`
  rewrites `title`/`imageId` and the override is untouched — no "is this
  user-set?" flag to read, no conditional in the write path. This is why the
  separate-field shape beats a single `title` + `titleSource` provenance flag: the
  extractor stays a blind writer.
- **Revert is trivial.** Clearing `customTitle` (delete the field) falls back to
  the still-present extracted `title` — the discovered value was never destroyed.
- **One file, one LWW point.** A manual override and a concurrent extraction
  backfill share only the link blob's existing LWW window (the bounded backfill
  race in _the data model_ above) — no new cross-file invariant.

> **Save-time title is sticky.** Any title the user types — whether **at save** or
> in a later edit — goes into `customTitle` and is **never** overwritten by
> extraction. `title` holds only the **provisional** value: a URL-host placeholder
> at save, replaced by the extracted og:title when `titleImage` lands. So a
> user-named link keeps its name forever; an unnamed one shows the placeholder
> until extraction fills `title` (or stays a bare host on a web-only client — the
> _web-only gap_).

### the extraction entity

`extractions/{id}.enc` plaintext (mirrors `pinSchema`: `id` repeats the link's
id, one self-contained file per link). Lives in `@stxapps/shared`
(`sync/entities.ts`), `z.looseObject` so older clients round-trip unknown fields.

A link is no longer **one** extraction with **one** lifecycle: title+image,
read-mode, screenshot, archive, keywords, tags, summary, and (deferred) vectors
are **independent jobs** — each produced by a different client/tier at a
different time, each able to be `pending` while another is `done`. So the entity
carries a **map of facet → state**, not a flat `status`:

```ts
export const facetSchema = z.looseObject({
  status: z.enum(['pending', 'done', 'failed']),
  tier: z.enum(['active-page', 'bg-fetch', 'server']).optional(), // who/quality produced it
  extractedBy: z.string().optional(), // client/device id — provenance
  extractedAt: z.number().int().optional(),
  attempts: z.number().int(), // backoff counter
  nextEligibleAt: z.number().int().optional(), // don't retry before this;
  // omit + status:'failed' = permanent (404/410)
  claimedBy: z.string().optional(), // soft TTL lease — cross-device dedup, per facet
  claimedAt: z.number().int().optional(),
});

export const extractionSchema = z.looseObject({
  id: z.string(), // = the link's id ({id} of links/{id}.enc)
  facets: z.record(
    z.enum([
      'titleImage',
      'readMode',
      'screenshot',
      'archive',
      'keywords',
      'tags',
      'summary',
      'vectors',
    ]),
    facetSchema,
  ),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Facet = z.infer<typeof facetSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
```

Each facet answers the same questions independently:

- **who** → `extractedBy` / `tier`; **when** → `extractedAt`; **quality** →
  `tier` (active-page beats bg-fetch beats server).
- **don't retry forever** → `attempts` + `nextEligibleAt` for transient failures;
  `status: 'failed'` with no `nextEligibleAt` for hard ones (404/410, robots
  block). Because this is **synced**, one device's failure stops _every_ device
  retrying that facet — not the per-device thrash a device-local marker would give.
- **cross-device dedup** → the `claimedBy` + `claimedAt` soft lease, now **per
  facet** so the extension claiming `screenshot` doesn't block the phone claiming
  `summary` on the same link. It's a **soft TTL lease, not a hard lock**: for a
  single user with a few of their own devices contention is rare, so a lease to
  cut obvious duplicate work plus file-level LWW to resolve races is enough —
  don't reach for distributed locking.
- **upgrade** → a client whose `tier` beats a facet's stored `tier` may
  re-extract that `done` facet (e.g. you open the real page in the extension
  after a background bg-fetch only got title + image).

**Path layout — one flat file per link, facets inside; not one prefix per
facet.** We deliberately keep `extractions/{id}.enc` (flat — fits the existing
`{prefix}{id}.enc` / `ID_KEYED_PREFIXES` grammar) rather than splitting to
`extractions/{facet}/{id}.enc`. A per-facet split would fully isolate each facet's
write, but it multiplies extraction objects per link by the facet count (~8×),
turns the single-segment key into a 2-level path the sync engine doesn't parse
today, and only buys protection against a **rare, self-healing** race: two
devices completing two _different_ facets of the _same_ link inside one sync
window file-level-clobber each other, and the lost `done` simply looks `pending`
and re-extracts (idempotent — the same residual-cost class as the `links`
backfill write). Keeping every facet in one blob also makes the cross-facet
**upgrade** decision a single-file read. **Flip condition:** if you later want
**selective sync by facet** (a constrained client syncing only the facets it can
produce) or a facet turns individually high-churn, split _that_ facet out — and
split **facet-first** (`extractions/{facet}/{id}.enc`, the per-facet queue-scan
axis), never link-first. Don't pre-pay it.

Wire it the standard three-step (see `paths.ts` header — _adding a namespace_):
add `EXTRACTIONS_PREFIX = 'extractions/'` to `paths.ts`, add it to
`ID_KEYED_PREFIXES`, add `extractionSchema` here. On `linkSchema` (already done
for the display fields, beside `pageArchiveId`, same `files/{id}.enc` reference
pattern and plaintext-typing rule — see [local-first-sync.md](./local-first-sync.md)
_plaintext typing_): `imageId?` (the `titleImage` facet's preview image),
`customTitle?` / `customImageId?` (the manual overrides — see _manual overrides_),
and `screenshotId?` (the `screenshot` facet, when that facet is wired).

### the queue is a query, not a structure

There is **no separate queue object**. A client's extraction work loop is a query
over synced state:

- **default tier (title + image, read-mode):** a link with no `extractions/` file,
  or one whose `status` is `pending` and not claimed within the lease window.
- **best-effort tier (screenshot/archive):** an _active-context_ save extracts
  immediately and writes `files/` + the `links/` ref; the background loop's only
  job is to spot links **missing** those refs (`screenshotId` / `pageArchiveId`
  absent) that this client's tier can satisfy — the absence _is_ the pending
  signal, no explicit field needed.

The loop: **claim** (write the lease) → **extract** → **write back** (result into
`links/` and/or `files/`, bookkeeping into `extractions/`) → all of it syncs as
ordinary encrypted blobs through the existing engine. The extension and the Expo
app run the **same loop** against the same contract — the reason the schema lives
in `shared`.

### everything is async; nothing blocks the save

The save path is unchanged: writing `links/{id}.enc` makes the link exist
**immediately** (see [local-first-sync.md](./local-first-sync.md) — _push_). All
extraction is **fire-and-forget after that** — the user never waits on a fetch or
a render, on any client. Results arrive later and the UI updates reactively when
the patched `links/`/`extractions/` blobs land in Dexie (`liveQuery`). This holds
regardless of tier: an active-tab capture and a background catch-up are both
post-save, off the critical path.

### what each client syncs — the extension is a selective-sync client

An extraction worker does **not** need the user's whole library, and the sync
engine already lets it opt out cheaply: `ops/list` returns **metadata only**
(`{ op, path, updatedAt }`), and **downloading a blob is per-path and
client-driven** (see [local-first-sync.md](./local-first-sync.md) — _a sync
cycle_). So a client chooses which namespaces it materializes, with **no new
endpoint and no server change** — it just pulls the op-list and skips the GETs for
prefixes it doesn't care about. This is the selective-sync flip the entity section
flags, realized at the namespace granularity rather than the facet one.

For an extension whose job is extraction + save, the minimum working set is:

- **eagerly: `links/` + `extractions/`.** Both are needed — and `extractions/`
  **alone is not enough**:
  - a freshly-saved link has **no** `extractions/` file (its absence _is_ the
    pending signal), so new work is only discoverable from the `links/` index;
  - the **URL** to fetch lives in `links/{id}.enc`;
  - write-back of `title`/`imageId` is a **read-merge-write** that must round-trip
    the link blob's unknown fields (the `looseObject` rule), so the current link
    blob has to be in hand.
    For 10 000 links this is ~2.5 MB (`links/`) + a sparse, tiny `extractions/` set —
    trivial.
- **lazily / never: `files/`.** Heavy content is on-demand for **every** client
  already; the extension fetches a `files/` blob only to **upgrade** an existing
  screenshot/archive, never routinely.
- **skip entirely: `tags/` `lists/` `pins/` `settings/`** — none are inputs to
  extraction. (If the extension later grows a browse/library UI it'll want these
  too, but that's a UI decision, not an extraction requirement.)

The cursor still advances across **all** ops (it's the global high-water mark);
selective sync only changes which blobs get downloaded, not how the cursor moves.

### server extraction (deferred): a separate `brace-extractor`, anonymous

The escape hatch from _the stance_ — letting a server fetch URLs when no capable
client is installed — is the **second, explicit opt-in**, never the default. When
it's built it is a **separate app**, not a route in `brace-api`:

- **A new nx app, `brace-extractor` (`type:app`, `platform:worker`), on its own
  origin `extract.brace.to`** — distinct from the blind sync broker on
  `api.brace.to`. The two have **opposite trust and egress postures**: the broker
  only ever touches D1/R2 and ideally reaches nothing outbound; the extractor must
  `fetch` arbitrary, user-supplied URLs. Separate apps let each hold only the
  bindings it needs, keep "`api.brace.to` only ever sees ciphertext" a clean,
  code-provable claim, and give server extraction an independent kill switch /
  opt-in / jurisdiction. Workers is a _good_ fit precisely because its sandbox
  can't reach your private network or cloud IMDS (`169.254.169.254`), which
  neutralizes the classic server-side-fetch SSRF.
- **Pure function, never a writer.** `brace-extractor` takes
  `POST { urls } → { title, image, readMode, … }` **plaintext** and returns it to
  the requesting client. The **client** (which holds the data key) does the E2E
  write-back into `links` / `files` / `extraction`. The extractor **holds no key,
  persists nothing, writes no blob** — so what it can leak is transient (a URL it
  saw mid-fetch), not stored. Results it produces carry `tier: 'server'` (lowest
  quality, above nothing), so any active-page client can later **upgrade** them.
- **Anonymous, not session-bound.** Requiring a logged-in session id would
  convert the leak from "the server saw this URL" into "the server can tie this
  URL to _this account_" — a **strictly worse** leak than the one this whole doc
  is built to avoid. So v1 is **anonymous**: IP-based rate limiting (already in
  place) plus an SSRF guard and strict size/time caps; the extractor never learns
  _who_ is asking. The abuse-control upgrade that **preserves** anonymity is blind
  capability tokens (Privacy Pass / VOPRF): `api.brace.to` issues unlinkable
  tokens to real logged-in users, `extract.brace.to` verifies validity without
  learning which user — deferred, documented as the direction.

This stays **deferred and off by default**; only the invariants above are
committed now (separate app, separate origin, anonymous, plaintext-return-only).

### the web-only gap (a conscious stance)

A user on **`brace-web` only** — no extension, no phone — gets **no enrichment**:
a saved link stays a bare URL with whatever title they typed. This is the direct,
intended consequence of "clients do the work, the server stays blind." It is
**not** a bug to paper over:

- it keeps the default maximally private (nothing fetches your URLs until you
  install a client that does it locally);
- it's a gentle nudge toward the extension, which is the best extractor anyway
  (active-tab DOM + screenshot);
- the link-editor popover's promise that "the title is back-filled later" simply
  doesn't apply to this user — they only ever have the title they entered.

If that gap ever becomes unacceptable, the escape hatch is the deferred
**server extraction** path — a separate `brace-extractor` app on its own origin
(see _server extraction (deferred)_) — a separate, explicit opt-in, never the
default.

### deferred / open

- **Read-mode quality on JS-rendered pages.** Raw-HTML extraction (background
  fetch, or a Worker if ever enabled) is good on server-rendered articles, poor
  on SPAs. Active-tab/WebView extraction (live DOM) is the high-quality path;
  background is best-effort. No fix beyond the tier model — just don't promise
  read-mode parity across tiers.
- **Re-extract / upgrade UX.** The `tier` field _enables_ upgrading a low-tier
  result, but the trigger (automatic on a higher-tier sighting vs. a manual
  "re-extract" button) is an open product call.
- **Archive on background tier.** Capturing a full archive without an open
  page is the weak spot (offscreen/hidden-tab rendering is heavy and flaky). For
  now archive is active-context-only; a headless background archiver is deferred.
- **Manual capture.** A user-facing "fetch metadata / capture now" action for
  links that auto-extraction missed (a `failed` link, or a web-only user who
  installs the extension later) — the loop already supports re-running; this just
  exposes a trigger.
