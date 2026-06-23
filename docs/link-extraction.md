## link extraction

How brace fills in a saved link's **title, image, read-mode text, screenshot,
and archived page** — the metadata a bare URL doesn't carry. See
[local-first-sync.md](./local-first-sync.md) for the encrypted-file data path
this rides on (one entity per `*.enc` blob, file-level LWW), the `pins/`
precedent for the LWW-isolation move repeated here, and the `meta` vs `files`
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
> documented but **unused**; if it's ever revived it must be its own explicit,
> second opt-in, distinct from client extraction, because its privacy profile is
> strictly worse.

### capability tiers — not every client can do every job

Fetching a URL is easy wherever there's no CORS; **screenshots and archives are
the hard part, and only an _active page context_ does them well.** This
asymmetry drives the whole result/queue design.

| client / mode                          | title + image | read mode        | screenshot              | archive |
| -------------------------------------- | ------------- | ---------------- | ----------------------- | ------- |
| extension — **icon click, active tab** | ✅ live DOM   | ✅ live DOM      | ✅ `captureVisibleTab`  | ✅      |
| extension — **background, queued URL** | ✅ raw HTML   | ⚠️ raw HTML      | ❌ no open tab          | ⚠️      |
| mobile — **share sheet (foreground)**  | ✅            | ✅ WebView       | ⚠️ WebView render       | ⚠️      |
| mobile — **background queue**          | ✅            | ⚠️               | ❌                      | ❌      |
| `brace-api` Worker (**unused**)        | ✅            | ✅ (linkedom)    | ❌ needs Browser Rndr.  | ❌      |
| third-party service (**rejected**)     | ✅            | ✅               | ✅                      | ✅      |

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

### the data model: result in `meta`, bookkeeping in `extraction/`

There are two kinds of state, and conflating them is the trap:

1. **Display result** — the title/image the UI renders, the heavy refs it opens.
   Written **once** on completion. Belongs in `meta/{id}.enc`, the always-resident
   list-view blob, so the library renders offline and the UI never has to join a
   second file to draw a row. Heavy outputs (screenshot, archived page) stay in
   `files/{id}.enc` referenced by id, exactly as `pageArchiveId` already is.
2. **Coordination + provenance** — who extracted, when, at what quality, whether
   it's claimed, whether it failed and when to retry. This is **churny,
   automated** state written by background actors on a different schedule than
   user edits.

Putting (2) in `meta` would repeat the mistake the `pins/` design exists to
avoid: a churny `pending → claimed → done/failed` field rewriting the link blob
clobbers a concurrent user title/tag edit under file-level LWW, and bloats the
`< ~2 KB` metadata budget. By the same reasoning that gives pins their own file,
**coordination state gets its own LWW-isolated file, `extraction/{id}.enc`,
shadowing `meta/{id}.enc`** (`{id}` = the link's id), one file per link.

The split keeps **one source of truth for the title** (it lives only in `meta`,
never copied into `extraction/`); `extraction/` answers only "who/when/quality/
retry?", which `meta` deliberately doesn't carry.

> **The one residual cost.** Completing an extraction writes _two_ files: the
> `meta` title/image backfill _and_ the `extraction/` bookkeeping. The `meta`
> write is a read-merge-write, so it has the usual small LWW clobber window
> against a concurrent user title edit (see [local-first-sync.md](./local-first-sync.md)
> — _conflict policy_). Bounded, one-time (not churny), and acceptable for a
> single-user app — the same tradeoff every backfill write makes.

### the extraction entity

`extraction/{id}.enc` plaintext (mirrors `pinSchema`: `id` repeats the link's
id, one self-contained file per link). Lives in `@stxapps/shared`
(`sync/entities.ts`), `z.looseObject` so older clients round-trip unknown fields:

```ts
export const extractionSchema = z.looseObject({
  id: z.string(),                 // = the link's id ({id} of meta/{id}.enc)
  status: z.enum(['pending', 'done', 'failed']),
  tier: z.enum(['active-page', 'bg-fetch']).optional(), // who/quality produced the result
  extractedBy: z.string().optional(),       // client/device id — provenance
  extractedAt: z.number().int().optional(),
  attempts: z.number().int(),               // backoff counter
  nextEligibleAt: z.number().int().optional(), // don't retry before this;
                                               // omit + status:'failed' = permanent (404/410)
  claimedBy: z.string().optional(),         // soft TTL lease — cross-device dedup
  claimedAt: z.number().int().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Extraction = z.infer<typeof extractionSchema>;
```

What each requirement maps to:

- **who** → `extractedBy` / `tier`; **when** → `extractedAt`; **quality** →
  `tier` (active-page beats bg-fetch).
- **don't retry forever** → `attempts` + `nextEligibleAt` for transient failures;
  `status: 'failed'` with no `nextEligibleAt` for hard ones (404/410, robots
  block). Because this is **synced**, one device's failure stops _every_ device
  retrying — not the per-device thrash a device-local marker would give.
- **cross-device dedup** → the `claimedBy` + `claimedAt` soft lease, so your
  laptop and phone don't both process the same link. It's a **soft TTL lease, not
  a hard lock**: for a single user with a few of their own devices contention is
  rare, so a lease to cut obvious duplicate work plus file-level LWW to resolve
  races is enough — don't reach for distributed locking.
- **upgrade** → a client whose `tier` beats the stored `tier` may re-extract a
  `done` link (e.g. you open the real page in the extension after a background
  bg-fetch only got title + image).

Wire it the standard three-step (see `paths.ts` header — _adding a namespace_):
add `EXTRACTION_PREFIX = 'extraction/'` to `paths.ts`, add it to
`ID_KEYED_PREFIXES`, add `extractionSchema` here. Also add `screenshotId?:
string` to `linkSchema` beside `pageArchiveId` (same `files/{id}.enc` reference
pattern, same plaintext-typing rule — see [local-first-sync.md](./local-first-sync.md)
_plaintext typing_).

### the queue is a query, not a structure

There is **no separate queue object**. A client's extraction work loop is a query
over synced state:

- **default tier (title + image, read-mode):** a link with no `extraction/` file,
  or one whose `status` is `pending` and not claimed within the lease window.
- **best-effort tier (screenshot/archive):** an _active-context_ save extracts
  immediately and writes `files/` + the `meta` ref; the background loop's only
  job is to spot links **missing** those refs (`screenshotId` / `pageArchiveId`
  absent) that this client's tier can satisfy — the absence _is_ the pending
  signal, no explicit field needed.

The loop: **claim** (write the lease) → **extract** → **write back** (result into
`meta` and/or `files`, bookkeeping into `extraction/`) → all of it syncs as
ordinary encrypted blobs through the existing engine. The extension and the Expo
app run the **same loop** against the same contract — the reason the schema lives
in `shared`.

### everything is async; nothing blocks the save

The save path is unchanged: writing `meta/{id}.enc` makes the link exist
**immediately** (see [local-first-sync.md](./local-first-sync.md) — _push_). All
extraction is **fire-and-forget after that** — the user never waits on a fetch or
a render, on any client. Results arrive later and the UI updates reactively when
the patched `meta`/`extraction` blobs land in Dexie (`liveQuery`). This holds
regardless of tier: an active-tab capture and a background catch-up are both
post-save, off the critical path.

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

If that gap ever becomes unacceptable, the escape hatch is the documented-but-
unused `brace-api` title fetch (see _the stance_) — a separate, explicit opt-in,
never the default.

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
