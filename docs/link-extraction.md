## link extraction

How brace fills in a saved link's **title, image, read-mode text, screenshot,
and saved page copy** — the metadata a bare URL doesn't carry. See
[local-first-sync.md](./local-first-sync.md) for the encrypted-file data path
this rides on (one entity per `*.enc` blob, file-level LWW), the `pins/`
precedent for the LWW-isolation move repeated here, and the `links/` vs `files/`
split; [architecture.md](./architecture.md) for package layering;
[extension.md](./extension.md) for the brace-extension auth flow the privileged
client builds on; and [account.md](./account.md) for the data key that protects
every blob written here.

**Naming — "page copy", never "archive".** The saved-page capture is the
`pageCopy` facet, stored as `extraction.pageCopyId`, metered by
`entitlements.maxPageCopies`, and shown to users as "page copy". The word
**archive is reserved for the ARCHIVE_ID system list** (`sync/system-lists.ts`)
— a link the user filed away, which has nothing to do with capturing page
bytes. The two senses shared the word until they were split (the meter was
`maxArchivedLinks`, which read like a cap on the Archive list and was not).
Keep them apart in code, comments, and UI copy.

### the shape of the problem

A saved link starts as just a URL. To enrich it you must **fetch the page** (for
title/image/read-mode) or **render it** (for screenshot/page-copy). Two hard
constraints decide where that can happen:

- **CORS.** A `fetch()` to an arbitrary third-party URL from a web app — main
  thread _or_ a Web Worker, same rules — is blocked for almost every site. The
  browser tab in `brace-web` simply **cannot** retrieve arbitrary page HTML. A
  Web Worker doesn't change this; it only helps with CPU-bound parsing of HTML
  something else already fetched.
- **Rendering.** Screenshots and full page copies need a real rendering engine
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
  **extension** and the (future) **Expo** app — or a client _orchestrating_ the
  opt-in `brace-extractor` for a web-app save (it holds the key and writes the
  result back; see _who extracts_). `brace-api` never fetches a URL either way.
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
> latency or cost — it's that the server would see the URL. That's why server
> extraction never lives in `brace-api`: it's its own explicit, second opt-in,
> distinct from client extraction, in a **separate app on a separate origin**
> (`brace-extractor`) — never a route in the blind sync broker — because its
> privacy profile is strictly worse. See _server extraction_.

### capability tiers — not every client can do every job

Fetching a URL is easy wherever there's no CORS; **screenshots and page copies are
the hard part, and only an _active page context_ does them well.** This
asymmetry drives the whole result/queue design.

| client / mode                          | title + image      | read mode   | screenshot             | page copy |
| -------------------------------------- | ------------------ | ----------- | ---------------------- | --------- |
| extension — **icon click, active tab** | ✅ live DOM        | ✅ live DOM | ✅ `captureVisibleTab` | ✅        |
| ~~extension — background, queued URL~~ | —                  | —           | —                      | —         |
| mobile — **share sheet**               | ⚠️ host-provided   | ❌          | ❌                     | ❌        |
| mobile — **foreground**                | ✅                 | ✅ WebView  | ✅                     | ✅        |
| mobile — **background queue**          | ⚠️ best-effort     | ⚠️          | ❌                     | ❌        |
| `brace-extractor` Worker               | ✅                 | ✅          | ❌ needs Browser Rndr. | ❌        |
| import                                 | ⚠️ export-provided | ❌          | ❌                     | ❌        |

The struck row is the **decision below**: the extension _could_ bg-fetch queued
URLs with an `<all_urls>` host grant, but we **don't** — that capability moves to
`brace-extractor` / mobile background.

The two mobile rows split a real platform seam. The **share sheet** is a
memory-constrained, short-lived share _extension_ — it can't reliably stand up a
WebView to render, fetch, or screenshot — so it captures only **host-provided
metadata** (a title the originating app hands it) as a **provisional
`extraction.title`** and leaves the actual extraction to the queue; it is a save
context, not an extractor (the same provisional-seed pattern a bulk import uses —
see _imported links_ — so it emits **no `extractedBy` tier of its own**, and the
`extractedBy` enum stays `expo:fg | expo:bg`, no share-sheet value). The
**foreground** (the full app open) is mobile's true active-context tier: native
fetch / a controllable WebView give it title+image, read-mode, screenshot, and
page copy — the `expo:fg` active-page tier, peer to the extension's active tab.

The **`import`** row is the same shape one step further out: a bulk import does
**no fetch of its own** — it seeds a provisional `extraction.title` from the
export (a title only, never an image, hence `⚠️ export-provided` not
`best-effort`: nothing is _fetched_, so nothing can be "best effort") and hands
every link to the queue, later drained by `brace-extractor` / mobile background /
an active-page client on first open (see _imported links_). So the share sheet and
`import` are both **save contexts that seed a title, never extractors** — the ✅
rows are the contexts that actually fetch.

Two consequences baked into the design:

- **Background queue processing (where it exists) is metadata + read-mode only.**
  A queued URL has no open tab, so it can't be screenshotted without opening one
  (heavy, flaky). On mobile, background time is a few unreliable seconds. So:
  **screenshot/page-copy are best-effort, captured only from the active context**
  (icon click / foreground share). Don't fight the platforms to background them.
- A link extracted at a **low tier** (background raw-HTML, no screenshot) should
  be **upgradable** when a **higher-tier** client later sees it — which means the
  system must record _who_ produced the current result (`extractedBy`, from which the
  tier is derived). See
  _the extraction entity_.

#### the extension is active-context only (no `<all_urls>`)

The extension deliberately **does not** do background bg-fetch extraction, even
though it technically could. Background fetching of arbitrary saved URLs requires
a broad host grant (`<all_urls>` in `host_permissions`), and that grant is a poor
trade:

- **Install warning.** A required `<all_urls>` grant shows Chrome's scariest
  install warning — _"Read and change all your data on all websites"_ — before the
  user has any context for why a bookmark saver needs it. Worst-case install
  conversion. `optional_host_permissions` only defers the prompt to a contextual
  moment; it doesn't remove it, and still draws review scrutiny.
- **Store review.** A required broad host grant trips heightened review on both
  the Chrome Web Store and Firefox AMO (mandatory source review + a written
  justification). "We background-fetch pages you saved elsewhere" is exactly the
  pattern reviewers read as possible exfiltration/injection.
- **It buys the extension's _weakest_ tier.** `<all_urls>` unlocks only the
  background **bg-fetch** tier (title+image from raw HTML, no screenshot/page-copy).
  The extension's _unique, irreplaceable_ value — active-tab DOM,
  `captureVisibleTab`, page copy — needs only **`activeTab` + `scripting`**, which
  carry **no broad-host warning at all**. So the broad grant costs the biggest
  install-funnel hit to add the lowest-quality capability.
- **That capability has a better home.** The background/bg-fetch residual
  (cross-device pickups, bulk-import draining) is what the
  **`brace-extractor`** server path owns anyway — _"interactive saves justify
  avoiding `brace-extractor`; imports justify building it"_ (see _imported links_,
  _server extraction_). Paying `<all_urls>` to build a flaky,
  MV3-ephemeral version of that is the wrong split — and dropping it is part of why
  `brace-extractor` is now a **necessary** app, not a someday one.

So the extension extracts **only from the focused active tab** (`extractedBy:
'extension:fg'`, active-page tier) and runs **no headless background extraction
sweep** — its background service worker does sync only. The tier/queue machinery
below (`extractedBy`, the facet bookkeeping, the pending-work query) stays
tier-agnostic and shared; it's the _bg-fetch arm in the extension_ that's dropped,
not the model. The accepted cost: a link saved on another device isn't silently
back-filled by a desktop extension in the background — it enriches when opened in
the extension (active-page upgrade) or via `brace-extractor` (if opted in),
otherwise it stays the _web-only gap_.

**Why this _doesn't_ extend to the mobile app (`brace-expo`).** The instinct is
that the same logic forbids background extraction on mobile too — it doesn't,
because the reason above is **permission-shaped, and mobile has no equivalent
cost**. A native app has **no CORS and no host-permission model**: it `fetch`es any
URL without declaring per-host access, so there is **no `<all_urls>`-equivalent
install warning** and no broad-host store-review flag (the native-HTTP escape hatch
this doc opens with). The entire load-bearing argument against the extension's
background sweep — the warning + the review — is simply **absent** on mobile, so
reusing the conclusion would be cargo-culting it without its premise. What _does_
limit mobile background is **reliability/battery, not permissions** — iOS
`BGAppRefreshTask`/`BGProcessingTask` windows are opportunistic and unpredictable,
Android has Doze/WorkManager throttling — and that's a reason to cap it at
**best-effort**, not to forbid it. Privacy doesn't argue against it either: a
background mobile fetch is a trusted, key-holding client doing local E2E work, the
same privacy profile as the extension's _foreground_ capture — no new party learns
the URL. So `brace-expo` **keeps** background extraction (`expo:bg`, bg-fetch tier),
best-effort: the **foreground** (full app) is its active-context tier — the share
sheet is only a constrained save context that seeds a host-provided provisional
title — an opportunistic background drain handles the residual, and the
bulk-import drain still belongs to
`brace-extractor` (don't promise mobile-background throughput). One-line contrast:
**the extension's background is dropped for a permission cost mobile doesn't pay;
mobile's background stays, capped at best-effort for a reliability limit the
extension's design never turned on.**

### who extracts: the client that did the save

Capability tiers say what each client _can_ do; this says _who actually does it_
for a given link. The rule is simple and removes almost all cross-client
coordination: **the client that performs the save extracts that link, at save
time, from the best context it has.**

| save happens on…            | extracts title+image via                      | tier        | cost / privacy                                                         |
| --------------------------- | --------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| **extension** (address bar) | the live active tab                           | active-page | free, private, best — also gets screenshot/page-copy for free          |
| **mobile / foreground**     | native fetch (no CORS) / a WebView            | active-page | free, private                                                          |
| **web app**                 | **calls `brace-extractor`**, then writes back | server      | server sees the URL — opt-in, off by default (see _server extraction_) |

The third row is the correction to an easy misread of _the stance_: "the web app
can't extract" is true only of **fetching** — a `brace-web` tab can't `fetch` an
arbitrary URL (CORS). But the web app **holds the data key**, so it can still
_orchestrate_ extraction: `POST` the URL to `brace-extractor`, get plaintext
title+image back, encrypt, and write the result into `extractions/`/`files/` itself.
`brace-extractor` is a pure function (see _server extraction_); the web app is
the client that drives it. So a web-app save is enriched at save time **if** the
user has opted into server extraction — otherwise it stays the documented
_web-only gap_.

A mobile save reaches the active-page row above only from the **foreground** app.
The mobile **share sheet** is the one save context that **doesn't** extract inline
— it's a constrained share _extension_, so it captures only host-provided metadata
as a provisional `extraction.title`, leaves the `titleImage` facet **pending**, and
lets the foreground/background queue do the real extraction later (the same
provisional-seed pattern as a bulk import — see _imported links_, _capability
tiers_).

**Preference order on a web-app save.** `brace-extractor` is the _fallback_, not
the first choice. When a capable extension is present in the **same browser**, the
more private path is to let _it_ extract — locally, so no server ever sees the URL
— and that result reaches the web app's list through **synced `links/`**, the
cross-client bus, with no direct handoff. So the order is **same-browser
extension (local, private) → `brace-extractor` (opted-in, server sees the URL) →
web-only gap**. The corollary: when the extension is installed, the _best_ save
path is the extension itself (its toolbar button / context menu / shortcut) — it
saves and extracts inline at **active-page** tier, the highest quality and most
private, with zero cross-client coordination. Treat `brace-web`'s own save UI as
the path for when no extension is there. Both clients are full participants in the
bus: the web app syncs its library as the primary, full-sync client; the extension
as a **selective-sync** client (see _what each client syncs_).

Two consequences:

- **The background queue is a safety net, not the primary path.** Because each
  save is extracted by the client that made it, the `extractions/` pending
  machinery (extract → write-back) exists only for the **residual**: a
  save on a client that couldn't extract, later picked up by one that can
  (cross-device), and **bulk imports** (see _imported links_). Steady-state, the
  query is mostly empty.
- **No web→extension _save handoff_ — but a content-script presence bridge is
  right.** It's tempting to route a web-app save _directly_ to a same-browser
  extension so the extension extracts it. Don't do that as a **data/save
  handoff**: the cross-client bus is already **synced `links/` + `extractions/`**,
  so a web-app save reaches the extension through sync — **cross-device, with no
  extension-id handshake**. And a handoff has nothing to unlock anyway: the
  extension is **active-context only** (no background bg-fetch — see _the extension
  is active-context only_), so it enriches a synced URL **only if the user actually
  opens it in a tab**, never headlessly — a save-channel can't change that. A direct
  save-channel would be a worse-constrained version of a path we already have. Note
  the extension's privacy advantage holds **only for `title+image`** (and
  read-mode), and only once opened: **screenshot/page-copy have no server path at
  all** (`brace-extractor` can't render), so those stay extension-active-tab only
  regardless of any bridge. What a thin **content-script
  bridge** _is_ for — and what the preference order above needs — is **presence
  detection: is a capable extension installed and signed in?** The web app can't
  choose "extension → server → gap" without knowing. Prefer a content-script
  bridge over `externally_connectable` for this: it doubles as a cross-browser
  presence signal (announce on injection / answer a ping) without hardcoding a
  per-store extension id, and `externally_connectable` for web pages is
  effectively Chrome-only. The bridge may also carry an optional **"sync now"
  nudge** to collapse the idle-poll wait — never the URL, never the save itself
  (see _the queue is a query_ for the cadence this feeds).

### the data model: user data in `links/`, everything machine-derived in `extractions/`

The split is **by writer**, and getting the axis right is the whole game:

1. **`links/{id}.enc` — user-authored only.** `url`, `listId`, `tagIds`,
   `customTitle`, `customImageId`, `note`. Every field is written by a user gesture
   (save, edit, tag, move, annotate). Nothing a background actor produces touches
   this file.
2. **`extractions/{id}.enc` — everything a machine derives.** Both the **display
   result** (`title`, `imageId`, `pageCopyId`, `screenshotId`) _and_ the
   **coordination/provenance** bookkeeping (the per-facet who/when/quality/retry
   map). `{id}` repeats the link's id; one file per link, shadowing `links/{id}.enc`.

Why this beats the older "display result in `links/`, bookkeeping in `extractions/`"
split (which divided by _render-need_, not writer): with title/image in `links/`,
completing an extraction did a **read-merge-write on the user's file**, which under
file-level LWW could **silently clobber a concurrent user edit** — change list,
retag, set `customTitle`. The two-field `customTitle ?? title` rule prevented a
_field_ collision but not the _file_-level one, and the damaging direction
(extraction overwriting a user's list/tags/title) is the **one unrecoverable race in
the whole design** — extraction never re-derives a user's list assignment. The
writer-split makes it **impossible by construction**: extraction writes only
`extractions/`, so it can never overwrite a `links/` field.

Two things fall out, both wins:

- **No more two-file completion.** Extraction completion now writes **one** file
  (`extractions/`, result + bookkeeping together), not two. A 5 000-link import is
  ~5 000 sync ops, not ~10 000.
- **Races that remain are self-healing.** The only LWW races left inside
  `extractions/` are between two extraction writes (e.g. two devices finishing two
  facets in one sync window) — idempotent, re-extract fixes them. No user data is
  ever on the losing side.

The cost is a **render-time join**: drawing a row needs both files, co-keyed by the
same `{id}` (the UI resolves `customTitle ?? extraction.title ?? host(url)` and
`customImageId ?? extraction.imageId`). For the virtual-scrolled window that's a
primary-key batch get + one extra decrypt per visible row — cheap; and sort/filter
(date/list/tag) is unaffected because those keys all stay on the `links/` record.
The one real edge is **title search**, which now spans two stores — see
[client-queries.md](./client-queries.md).

> **One source of truth per field still holds.** The displayed title resolves
> `customTitle ?? extraction.title`; each value lives in exactly one file
> (`customTitle` in `links/`, `title` in `extractions/`), never copied across.

### the preview image is a downloaded blob, never the remote URL

Extraction discovers the preview image as a **URL** (og:image / lead image). The
tempting shortcut is to store that URL and render `<img src>` straight from it —
no download, no `files/{id}.enc`, no quota, faster first paint. **Don't.**
`extraction.imageId` is a downloaded, encrypted `files/{id}.enc` blob; the URL is
only an _input to the fetch_, never persisted. **Who runs that fetch splits by
client:** an extension/mobile save downloads the og:image directly (native /
no-CORS); a web-app save **can't** — JS can't read cross-origin image bytes, an
`<img>` would only _render_ the URL (the per-paint leak this section forbids,
below) — so the bytes come through `brace-extractor`'s image proxy (see _server
extraction_). Either path ends with the bytes as an encrypted `files/{id}.enc`
blob, never the remote URL. Three reasons, heaviest first:

- **It would reintroduce the exact leak this whole doc avoids.** A remote URL in
  the always-resident `extractions/` blob means every device that renders the list
  `fetch`es that third-party host on every paint — beaconing the user's IP, that
  they saved the page, and timing to an arbitrary party (and its CDN/trackers),
  on _every viewing device, forever_, including the web-only client that
  otherwise never touches the URL. The **asymmetry** is the point: the
  _extracting_ client already fetched the page and already learned the URL — it's
  paid the privacy cost (see _the stance_) — so _it_ downloading the image bytes
  costs nothing extra, and once it writes the encrypted blob every other device
  reads only ciphertext through sync. Download = pay the privacy cost **once, at
  the client that already knows**; remote URL = pay it on **every render, on every
  device**.
- **It would break the offline / local-first promise.** An encrypted
  `files/{id}.enc` image is stable, synced, and offline-available — and
  lazy-fetched on scroll, so storing it costs nothing up front (see
  [local-first-sync.md](./local-first-sync.md) — _metadata vs content_; same
  heavy-media rule as `pageCopyId`/`screenshotId`/`customImageId`). A remote
  URL rots, gets hotlink-protected, silently changes content, needs the network,
  and is dark offline.
- **It would break the blob convention.** `imageId` is typed as a bare
  `files/{id}.enc` ref — "a field name types its blob" (see
  [local-first-sync.md](./local-first-sync.md) — _plaintext typing_) — the same
  rule as `screenshotId` / `pageCopyId` (its siblings in `extractions/`) and the
  user's `customImageId` in `links/`. A plaintext,
  externally-mutable `https://…` string is a new pattern the sync encryption path
  never sees, and a stored pointer-to-plaintext the encrypted blob isn't.

The cost is real and accepted: a one-time download, the bytes against the
per-user quota, and IndexedDB content accumulation (bounded by the deferred
content-cache LRU — see [local-first-sync.md](./local-first-sync.md) _deferred_).
It buys the privacy guarantee, and the cheaper "just use the URL" path is cheaper
**precisely because it leaks**. If first-paint latency ever matters, leave
`imageId` **absent** until the blob lands — the card shows no preview, the same
_web-only gap_ behavior — rather than rendering the remote URL as a placeholder,
because the placeholder _is_ the leak.

### manual overrides: `customTitle` / `customImageId`

A user can manually set a link's title and image. The override is a **pair of
optional fields on `linkSchema`** — `customTitle` and `customImageId` (a
`files/{id}.enc` ref to a user-picked image) — **not a new entity**. They sit in
`links/` beside `tagIds`/`listId` because a manual override is a **low-frequency
user edit** made in the same gesture as editing those; a separate
`customTitle/{id}.enc` would force one user edit to write two files and race them
under LWW. (The extracted counterparts, `title`/`imageId`, are the _opposite_ — a
machine writer on its own schedule — which is exactly why they live in
`extractions/`, not here.)

**Two fields across two files, so extraction and the user can never collide.** The
two halves split cleanly by writer _and_ by file:

- **extraction owns `extraction.title` / `extraction.imageId`** — the
  discovered/provisional values, in `extractions/`. It writes them unconditionally on
  completion or tier-upgrade, and **never reads or writes the `custom*` fields** (it
  doesn't even open `links/`).
- **the user owns `links.customTitle` / `links.customImageId`** — written only by the
  explicit "edit title/image" action, in `links/`.

The UI renders **`customTitle ?? extraction.title ?? host(url)`** and
**`customImageId ?? extraction.imageId`**, so a manual edit always wins. Three
properties fall out for free:

- **Re-extraction is safe.** A higher-tier client re-extracting `titleImage`
  rewrites `extraction.title`/`imageId` and the override — in a different file — is
  untouched. No "is this user-set?" flag, no conditional in the write path: the
  extractor stays a blind writer. This is why the separate-field shape beats a single
  `title` + `titleSource` provenance flag.
- **Revert is trivial.** Clearing `customTitle` (delete the field) falls back to the
  still-present `extraction.title` — the discovered value was never destroyed; if
  extraction never ran, it falls through to `host(url)`.
- **No shared LWW point at all.** A manual override writes `links/`; a concurrent
  extraction backfill writes `extractions/`. Different files — so unlike the old
  layout there is **no clobber window between them whatsoever**, not even a bounded
  one.

> **Save-time title is sticky.** Any title the user types — whether **at save** or in
> a later edit — goes into `customTitle` and is **never** overwritten by extraction.
> `extraction.title` holds only the **provisional** value, filled when `titleImage`
> lands (or pre-seeded from a bulk import — see _imported links_). An unnamed link
> shows `host(url)`, derived at render, until extraction fills `extraction.title` (or
> stays a bare host on a web-only client — the _web-only gap_). So a user-named link
> keeps its name forever; an unnamed one upgrades from host → og:title when extraction
> runs.
>
> **A _provided_ title (share-sheet host hint, bulk-import field) is provisional,
> not sticky.** It seeds `extraction.title` and stays replaceable by a later
> og:title or a higher tier — it is **not** auto-promoted to `customTitle`,
> because most provided titles are machine-captured (a browser bookmark's
> `<title>`, the source app's title), not names the user chose; freezing them
> would defeat the refresh and over-apply the sticky rule. **Promote a provided
> title to `customTitle` only when the source marks it user-authored** (e.g. a
> Pocket/Raindrop user-edited title) — otherwise leave it provisional. The
> asymmetry that makes this safe: a wrongly-frozen title is one edit away from
> fixed, whereas overwriting a provisional that lived only in `extraction.title`
> is **unrecoverable** — so when you _do_ have a user-authored signal, protect it
> via sticky `customTitle` (preserved + revertable), **never** a "don't-replace"
> flag on `extraction.title` (which can't tell a seed from a low-tier result and
> would also block legitimate tier upgrades).

### the extraction entity

`extractions/{id}.enc` plaintext (mirrors `pinSchema`: `id` repeats the link's
id, one self-contained file per link). Lives in `@stxapps/shared`
(`sync/entities.ts`), `z.looseObject` so older clients round-trip unknown fields.

The entity holds both halves of the machine-derived state: the **display result**
(the fields the UI renders) and the **bookkeeping**. A link is no longer **one**
extraction with **one** lifecycle: title+image, read-mode, screenshot, page copy,
keywords, tags, summary, and (deferred) vectors are **independent jobs** — each
produced by a different client/tier at a different time, each able to be pending
(no entry) while another is `done`. So the bookkeeping is a **map of facet →
state**, not a flat `status`:

```ts
export const facetSchema = z.looseObject({
  status: z.enum(['done', 'failed', 'permanent']),
  // done → success; failed → transient (retry after backoff);
  // permanent → hard failure (404/410, robots block) — never retry.
  // there is no 'pending': a facet with no entry (or a link with no
  // extractions/ file at all) IS pending — absence is the signal.
  extractedBy: z.string().optional(), // who ran the last attempt — a `platform:env`
  // string (extension:fg | expo:fg | expo:bg | server), NOT a device id. (The extension
  // is active-context only — it emits extension:fg only, never extension:bg; the :bg tier
  // comes from Expo background / brace-extractor. See "the extension is active-context only".)
  // Quality (the upgrade axis) is DERIVED from it by the shared tierOf() helper —
  // :fg → active-page beats :bg → bg-fetch beats server. No stored `tier` field: it's a
  // pure function of extractedBy (storing it beside its input is the same drift-prone
  // two-field invariant we avoid with nextEligibleAt). Left a z.string() (not an enum) so
  // a future platform/env round-trips through older clients; tierOf() ranks an unknown
  // value conservatively low.
  extractedAt: z.number().int().optional(), // when the last attempt ran — success time when done, last try when failed
  attempts: z.number().int(), // backoff counter — retry when now >= extractedAt + backoff(attempts)
});

export const extractionSchema = z.looseObject({
  id: z.string(), // = the link's id ({id} of links/{id}.enc)
  // display result — what the UI renders, the machine-written half of a link's
  // display (the user-written half, customTitle/customImageId, is on linkSchema):
  title: z.string().max(LINK_TITLE_MAX).optional(), // discovered/provisional og:title (or imported)
  imageId: z.string().optional(), // og:image preview — a files/{id}.enc ref, never the remote URL
  pageCopyId: z.string().optional(), // saved page copy — files/{id}.enc, from the `pageCopy` facet
  screenshotId: z.string().optional(), // full-page screenshot — files/{id}.enc, from `screenshot`
  // bookkeeping — partialRecord: a missing facet key = pending (not yet done):
  facets: z.partialRecord(
    z.enum([
      'titleImage',
      'readMode',
      'screenshot',
      'pageCopy',
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

**A present display field never implies its facet ran.** The facet map is the
**sole** authority for done/pending — never infer "`titleImage` is done" from a
non-empty `title`. `extraction.title` may legitimately hold a value while
`titleImage` is **absent** (= pending): a **provisional seed** from a bulk import
or a share-sheet host hint (see _imported links_, _capability tiers_). This is
deliberate and load-bearing — the seed is left pending **on purpose** so the
normal loop fetches the real og:title and replaces it. Two reasons it's a value
_without_ a facet, not a facet:

- **A facet records an extraction _attempt_** (`extractedBy` = who ran it,
  `extractedAt` = when, `attempts` = the retry count). A seed involves **no
  fetch** — nothing was extracted — so there is nothing truthful to put in those
  fields. Absence is the honest encoding; a `'server'`/`'importer'` `extractedBy`
  would record an attempt that never happened.
- **Marking the facet `done` to capture provenance would be doubly wrong:**
  semantically false (no attempt), and it would move the link off the
  well-defined **pending** path onto the under-specified **upgrade** path (see
  _deferred / open_) — `done` facets aren't re-run by the normal loop, only by a
  higher-tier sighting — which suppresses the very enrichment the import needs.
  And `extractedBy` has no reader but `tierOf()`, which already ranks a pending
  (absent) facet below every real tier, so a seed needs no tier of its own.

Each facet answers the same questions independently:

- **who / when** → `extractedBy` / `extractedAt` — a who/when pair describing the
  **last extraction attempt** (the success on a `done` facet, the last try on a
  `failed` one). `extractedBy` is a **`platform:env` string** (`extension:fg`,
  `expo:fg`, `expo:bg`, `server` — the extension emits `:fg` only, never
  `extension:bg`, being active-context only), **not a device id** — nothing reads
  it for identity (no claim lease, no per-device coordination), only for quality.
  **quality** → **derived** from `extractedBy` by the shared `tierOf()` helper:
  `:fg` → active-page beats `:bg` → bg-fetch beats `server`. There is **no stored
  `tier` field** — it's a pure function of `extractedBy`, and a derived value beside its
  input is the same drift-prone two-field invariant we reject for `nextEligibleAt`.
  `tierOf()` lives in `shared` next to `backoff()` (so every client agrees) and ranks an
  **unrecognized** value conservatively low, so a future `platform:env` a newer client
  emits round-trips through older clients (the `looseObject` rule — an unknown _enum
  value_ would instead fail to parse, which is why `extractedBy` stays a `z.string()`)
  without ever wrongly out-ranking a known active-page result.
- **retry, but not forever** → for a transient `failed`, the deciding client
  computes eligibility itself: retry once `now >= extractedAt + backoff(attempts)`.
  We **don't store a `nextEligibleAt`** — it's fully derived from `extractedAt`
  - `attempts` given the shared `backoff()` curve (which lives in `shared`, so
    every client agrees), and storing a derived value alongside its inputs is the
    same fragile two-field invariant we avoid elsewhere. A hard failure is the
    explicit **`status: 'permanent'`** (404/410, robots block) — never retried, no
    timestamp arithmetic, no implicit "failed-with-no-deadline = permanent" rule to
    get wrong. Because this is **synced**, one device's `permanent` (or fresh
    `failed`) stops _every_ device retrying that facet — not the per-device thrash a
    device-local marker would give. (The extractor's 429 `Retry-After` IS honored,
    but at the transport level — the drain's in-memory retry timer waits it out
    (extraction-provider `scheduleRetry`) and a wholesale transport failure is
    never recorded per-link — so no synced deadline field is needed. If a
    _per-link_ server deadline ever appears, it isn't derivable from `attempts`
    and earns its own field at that point — until then, don't pre-pay it.)
- **cross-device dedup** → **none, by design.** There is no claim lease. A lease
  would force an extra _write-claim-then-sync before extraction_ on the critical
  path, yet stay best-effort anyway (two devices waking in the same poll window
  both see "unclaimed" and both extract). The failure it guards against —
  duplicate extraction — is **self-healing**: the same URL yields the same
  title/image (idempotent) and file-level LWW keeps one write; the cost is a
  wasted fetch, not a wrong result. This is the same "don't reach for distributed
  locking" call, taken to its conclusion for a single user with a few devices.
  The one place duplicate work actually stings is a **bulk import** (two devices
  grinding the same thousands of URLs); the answer there is **deterministic
  sharding** (partition by `id` hash so devices self-divide with zero
  coordination), not a synced lease — and it's **deferred** until it proves real,
  since the device the import landed on usually drains it alone (see _imported
  links_).
- **upgrade** → a client whose **derived tier** (`tierOf(extractedBy)`) beats a `done`
  facet's may re-extract it (e.g. you open the real page in the extension —
  `extension:fg` → active-page — after a `server` extraction by `brace-extractor`,
  or an `expo:bg` mobile background fetch, only got title + image).

**Path layout — one flat file per link, facets inside; not one prefix per
facet.** We deliberately keep `extractions/{id}.enc` (flat — fits the existing
`{prefix}{id}.enc` / `ID_KEYED_PREFIXES` grammar) rather than splitting to
`extractions/{facet}/{id}.enc`. A per-facet split would fully isolate each facet's
write, but it multiplies extraction objects per link by the facet count (~8×),
turns the single-segment key into a 2-level path the sync engine doesn't parse
today, and only buys protection against a **rare, self-healing** race: two
devices completing two _different_ facets of the _same_ link inside one sync
window file-level-clobber each other, and the lost `done` simply looks pending
and re-extracts (idempotent — and since `extractions/` holds no user data, the
clobber only ever costs re-doable machine work). Keeping every facet in one blob
also makes the cross-facet
**upgrade** decision a single-file read. **Flip condition:** if you later want
**selective sync by facet** (a constrained client syncing only the facets it can
produce) or a facet turns individually high-churn, split _that_ facet out — and
split **facet-first** (`extractions/{facet}/{id}.enc`, the per-facet queue-scan
axis), never link-first. Don't pre-pay it.

Wire it the standard three-step (see `paths.ts` header — _adding a namespace_):
add `EXTRACTIONS_PREFIX = 'extractions/'` to `paths.ts`, add it to
`ID_KEYED_PREFIXES`, add `extractionSchema` here — with the **display fields**
(`title?`, `imageId?`, `pageCopyId?`, `screenshotId?`, all `files/{id}.enc` refs
except the inline `title`, same plaintext-typing rule — see
[local-first-sync.md](./local-first-sync.md) _plaintext typing_) alongside `facets`.
`linkSchema` keeps only the **user-authored** fields, including the manual overrides
`customTitle?` / `customImageId?` (see _manual overrides_); it carries **none** of
the extracted display fields — that's the writer-split (see _the data model_).

### the queue is a query, not a structure

Save-time extraction (see _who extracts_) handles the common case; this loop
drains the **residual** — cross-device pickups and bulk imports. There is still
**no separate queue object**: a client's extraction work loop is a query over
synced state:

- **default tier (title + image, read-mode):** a link with no `extractions/` file
  (absence _is_ pending), or a facet whose `status` is `failed` and now past its
  backoff (`now >= extractedAt + backoff(attempts)`). A `permanent` facet is
  skipped; there's no lease to check.
- **best-effort tier (screenshot/page-copy):** an _active-context_ save extracts
  immediately and writes the `files/` blob + the `extractions/` ref; the background
  loop's only job is to spot links **missing** those refs (`extraction.screenshotId`
  / `extraction.pageCopyId` absent) that this client's tier can satisfy — the
  absence _is_ the pending signal, no explicit field needed.

The loop: **extract** → **write back** (the result _and_ bookkeeping into
`extractions/`, heavy bytes into `files/` — never `links/`, which the extractor
never touches) → all of it syncs as ordinary encrypted blobs through the existing
engine. There is no claim step — a rare double-extraction is
resolved by idempotency + file-level LWW, not prevented by a lease (see _the
extraction entity_). The **headless background** drain of this loop belongs to the
clients that can run against a queued URL with no live tab — the **Expo app**
(an alarm sweep) and, for `brace-web`/desktop, the **`brace-extractor`** server they
call; **`brace-web` itself drains in-page** (see _the web drains in-page_ below), and
the **extension does not run a background drain at all** (it's active-context only —
see _the extension is active-context only_), so its only role in this loop is the
**active-context** capture on a save / on opening a page. All run against the **same
contract** — the reason the schema (including the shared `backoff()` curve) lives in
`shared`.

**Cadence is backlog-driven, not a fixed tick.** First separate the two costs the
word "poll" hides: the **local queue scan** (querying synced Dexie state for
pending work) is **free** — run it on every wake; only the **network sync poll**
(`ops/list`, to _discover_ another device's changes) costs anything, and that's
what cadence sizes. Because the loop is a query, a client sizes that sync poll to
how much is pending: **idle (a long alarm — around an hour) when the query is
empty**, ramping up to work a backlog down when it isn't (a fresh import, a batch
of cross-device saves), then settling back. The idle interval is a **ceiling /
backstop, not a fixed tick** — an hour is fine because `title+image` back-fills and
nothing waits on it, but a backlog must _not_ wait an hour between chunks. This
replaces a fixed fast poll — a 1-minute alarm spends a request every minute to
almost always find nothing, the worst case for a single-user app whose data
changes a few times a day. An empty poll returning "nothing pending" is the
**intended** steady state, not waste. Pair it with cheap local wake triggers so
freshness doesn't wait on the long alarm — browser start, popup/icon open, a save
performed _in_ the extension, and (if wired) the **content-script "sync now"
nudge** a `brace-web` save can post to a same-browser extension (see _who
extracts_ — presence bridge). **Don't reach for server push** for title+image:
nothing is on the critical path for it (the saving client already did it), so
there's no latency for push to remove. (Push only becomes interesting if the
extension ever becomes the authoritative background worker for a facet — which the
active-page facets aren't.)

#### the web drains in-page, scoped to what's on screen

`brace-web` has **no background service worker** — its sync engine already runs
in-page, and so does its drain: the **`ExtractionProvider`** (web-react), the
counterpart of the Expo alarm sweep and the extension's active-context role. Because
it's in-page it isn't alarm-paced; it's **`liveQuery`-reactive** — the pending query
re-runs on every store change (a save, an import, a cross-device link landing) and
wakes the drain, no fixed tick.

The cost shape is different enough from the headless clients to call out. Each
pending link is a **paid `brace-extractor` request** (HTML fetch + maybe an image
proxy), and an open tab can be **abandoned** — so the web drain must never bill the
server for work no one is watching. Three gates impose that, all of them UX/cost
**shaping on top of** the extractor's own non-negotiable per-IP caps (see _server
extraction_), never a substitute for them:

- **Visibility gate (automatic drain).** The _incidental_ drain runs only while the
  tab is **visible**; a hidden/backgrounded tab spends nothing on enrichment the user
  never asked for. **"Enrich all" is exempt** — it's explicit and finite (see below).
- **Displayed-scoped automatic drain.** The automatic drain works **only the pending
  subset of the links currently on screen** — the page the main pane has rendered,
  reported into the provider — not a blind walk of the whole library. So **work
  tracks attention**: a 30 000-link bulk import left in an open tab never enriches
  past what the user actually scrolled into view. This is still _the queue is a
  query_ — it's the **same `titleImage`-pending facet**, just queried over the
  displayed paths instead of the full library. A per-session **backstop cap** still
  trips for a user who deep-scrolls a huge library in one sitting, surfacing
  "enrich the rest?" rather than draining unbounded.
- **Explicit "enrich all".** Draining the **whole** library is a conscious,
  user-driven job — a full-library pending scan, lifted out of the displayed scope
  and the backstop cap. Unlike the automatic drain it **keeps running while the tab is
  hidden**, so the user clicks once and walks away instead of babysitting the tab. It
  isn't visibility-bounded because it's bounded by being **finite**: the cursor walk
  drains to the end of the library and then **ends the job** (it does _not_ stay armed
  to re-fire on later synced/imported links), with the extractor's per-IP caps as the
  hard floor; `pause()` stops it early. This is the **opt-in moment** a bulk import
  names ("enrich my whole library?" — see _imported links_), so the app **confirms at
  the button** ("Enrich all _X_ links?") and surfaces progress + controls rather than
  running behind the user's back.

On a **retryable** transport failure (a `429` from the extractor's per-IP cap, a
`5xx`, a network blip) the drain doesn't fail the job — it schedules a backed-off
**re-entry** into the loop (`scheduleRetry`). It deliberately does **not** use the
sync engine's `withRetry` wrapper (see [api-contracts.md](./api-contracts.md) —
_transport retry_): that blocks inline, but this loop must stay cancellable by
`pause()`, gated on tab visibility, and single-flighted — so it reuses the shared
retry _policy_ (`isRetryableTransportError` / `retryAfterMsOf` / `jitteredDelayMs`)
with its own _mechanism_. The scheduled re-wake is load-bearing for _enrich all_: a
failed batch writes no facets, so nothing else re-wakes the loop — the retry timer
is the only thing that resumes it after a `429`.

### imported links: the bulk path

Bulk import (a `bookmarks.html` export, Pocket/Raindrop/Pinboard, …) is the one
workload _save-time extraction can't own_, and the reason the queue path above
isn't optional. An interactive save is one link, at human pace, on the client
with the most context; an import is the inverse on every axis:

- **volume** — hundreds to thousands at once, not one-at-a-time;
- **no active context** — no live tab per link, so screenshot/page-copy are out and
  title+image is **bg-fetch tier at best** (raw HTML), never active-page;
- **the importer is usually the web app** — a dropped export file — which can't
  `fetch` at all.

So imported links flow through the **queue, not the save-time path**, and they
need **no new structure**: an imported link is a `links/{id}.enc` with **no
`extractions/` file**, which _is_ the pending signal — the normal loop picks it
up, and the `attempts`-driven backoff (retry once `now >= extractedAt +
backoff(attempts)`) already gives retry pacing for free. The one thing the queue
does _not_ give for free here is cross-device dedup: with no claim lease, two
devices draining the same thousands both fetch them (idempotent, so still
correct, just wasteful). If that ever bites, **deterministic sharding** by `id`
hash divides the work with zero coordination — deferred, because the device the
import landed on usually drains it alone (see _the extraction entity_). A title
carried in the export seeds **`extraction.title` (provisional)**, not
`customTitle` — the user didn't deliberately name it, so extraction may still
upgrade it to the real og:title; it's just a better placeholder than a bare host
meanwhile (see _manual overrides_). The exception: when the export marks a title
**user-edited** (some Pocket/Raindrop fields do), route _that_ one to sticky
`customTitle` instead, so a deliberate rename survives re-extraction — the
default-provisional / sticky-only-with-a-user-authored-signal rule from _manual
overrides_. This is the one case an import writes an
`extractions/` file up front — the pending signal then is the **absent `titleImage`
facet**, not an absent file (the queue query already keys on the facet).

**Imports are where `brace-extractor` stops being avoidable.** For a one-off web
save it's a nicety; for a bulk import, client-only draining is genuinely weak. A
web-only user gets thousands of bare URLs forever — and the **extension can't help
here at all**: it's active-context only (no background bg-fetch — see _the extension
is active-context only_), so it can only enrich an imported link if the user
manually opens it in a tab, which nobody does for thousands of imports. That leaves
**mobile background** (an `expo:bg` drain, also throttled and unreliable) or
`brace-extractor`. A bulk import is also the natural **opt-in moment** ("enrich my
whole library?" — in `brace-web` this is the explicit _enrich all_ drain, see _the
web drains in-page_). So the honest framing: _interactive saves justify **avoiding**
`brace-extractor`; imports justify **building** it_ — different workloads, different
answers.

The real concerns for the bulk path are throughput, not latency (enrichment
back-fills; the library is usable immediately):

- **batch and pace.** `brace-extractor` takes `POST { urls }` (plural) and
  IP-rate-limits — send chunks and respect backoff, never thousands of
  singletons. Same for an Expo background drain: pace per-host so one site isn't
  hammered (and bot-protection isn't tripped).
- **watch sync-op volume.** Each completion writes **one** `extractions/` blob
  (result + bookkeeping together — the writer-split removed the second, `links/`
  backfill write), so a 5 000-link import is ~5 000 writes through sync — still a
  burst, but half what the old layout cost.
- **progress is free** — "enriching 4 231 of 5 000…" is a count of links whose
  `extractions/` has no `done` `titleImage` facet, the same query the loop runs.
- **quality is upgradable.** Imports land at `server`/`bg-fetch` tier; opening the
  real page in the extension later upgrades to active-page via the existing tier
  rule. "Import cheap now, improve on first real visit" needs no new mechanism.

### everything is async; nothing blocks the save

The save path is unchanged: writing `links/{id}.enc` makes the link exist
**immediately** (see [local-first-sync.md](./local-first-sync.md) — _push_). All
extraction is **fire-and-forget after that** — the user never waits on a fetch or
a render, on any client. Results arrive later and the UI updates reactively when
the patched `extractions/` blob lands in Dexie (`liveQuery`); the join against the
unchanged `links/` row re-resolves the displayed title/image. This holds regardless
of tier: an active-tab capture and a background catch-up are both post-save, off the
critical path.

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
    pending signal), so new work is only discoverable from the `links/` namespace.
    Note the subtlety: **discovering** pending work needs only the link **paths** —
    the set difference (all link ids _minus_ those carrying a `done`/`permanent`
    `titleImage` token), both sides keyed off the op-list + the `*itemFacetStatuses`
    index, a primary-key prefix scan with no blob. So _detection_ alone would let
    `links/` ride at the **metadata-only** disposition (path + `updatedAt`, blob
    deferred — the same `data: undefined` mode `files/` uses). What forces the
    **full** link blob is the next two bullets, not detection. (Note: for the
    _extension_ the URL inside `links/{id}.enc` is **not** an extraction input — it's
    active-context only, so it extracts the focused tab's live DOM, never a synced
    URL. The URL-from-blob need is real only for the bg-fetch clients that drain
    queued URLs headlessly — **Expo background / `brace-extractor`** — not for the
    extension);
  - the extension popup's **"is this tab already saved?" dedup** (`readLinkByUrl`)
    is an `itemUrl` index hit, and `itemUrl` is **projected only from the decrypted
    link blob** — so the popup needs `links/` blobs resident, not just paths;
  - write-back of `title`/`imageId` is a **read-merge-write of the `extractions/`
    blob** that must round-trip its unknown fields (the `looseObject` rule), so the
    current extraction blob (if any) has to be in hand — but the link blob is never
    rewritten.
    For 10 000 links this is ~2.5 MB (`links/`) + the `extractions/` set (now holds
    the titles/refs too, no longer tiny, but still small) — trivial. So we keep
    `links/` at **full download**, not metadata-only: the two-line saving isn't worth
    losing popup dedup. (The engine
    _does_ have a latent third disposition — `skip` / metadata-only / full, today
    selected by `pathFilter` + the hardcoded `isContentPath` `files/` rule; promoting
    a namespace to metadata-only is the knob to reach for **only** when a heavy
    namespace is genuinely never read by that client, which `links/` isn't here.)
- **lazily / never: `files/`.** Heavy content is on-demand for **every** client
  already; the extension fetches a `files/` blob only to **upgrade** an existing
  screenshot/page-copy, never routinely.
- **pulled for the popup UI, not for extraction: `settings/` `lists/` `tags/`.**
  None are extraction inputs — they ride along because the popup renders more than a
  headless extractor. `settings/` feeds the ThemeProvider (`useSettings()` →
  `readSettingsGeneral()` resolves the synced theme / links layout). `lists/` and
  `tags/` feed the save **Editor**'s list/tag pickers (the shared `ListSelect` /
  `TagsField`, whose options come from the local store via `useLists()` →
  `readLists()` and `useTags()` → `readTags()`) — without them the editor shows only
  the system lists and zero existing tags. These are the "if the extension grows a
  browse/library UI it'll want these too" namespaces, now realized: a UI decision,
  not an extraction requirement. All three are small blob sets, so the cost is
  negligible.
- **skip entirely: `pins/`** — a browse-only ordering concern the popup never reads,
  and not an extraction input.

The cursor still advances across **all** ops (it's the global high-water mark);
selective sync only changes which blobs get downloaded, not how the cursor moves.

### server extraction: a separate `brace-extractor`, anonymous

The escape hatch from _the stance_ — letting a server fetch URLs when no capable
client is installed — is the **second, explicit opt-in**, never the default. It is
**necessary, not deferred**: once the extension went active-context only (no
background bg-fetch — see _the extension is active-context only_), `brace-extractor`
became the **only** bulk-enrichment path for `brace-web`/desktop users and the
realistic one for large imports, so it's a committed app to build, not a someday.
"Necessary to build" is **not** "on by default", though — server extraction stays
the second opt-in below. It is a **separate app**, not a route in `brace-api`:

- **A new nx app, `brace-extractor` (`type:app`, `platform:worker`), on its own
  origin `extractor.brace.to`** — distinct from the blind sync broker on
  `api.brace.to`. The two have **opposite trust and egress postures**: the broker
  only ever touches D1/R2 and ideally reaches nothing outbound; the extractor must
  `fetch` arbitrary, user-supplied URLs. Separate apps let each hold only the
  bindings it needs, keep "`api.brace.to` only ever sees ciphertext" a clean,
  code-provable claim, and give server extraction an independent kill switch /
  opt-in / jurisdiction. Workers is a _good_ fit precisely because its sandbox
  can't reach your private network or cloud IMDS (`169.254.169.254`), which
  neutralizes the classic server-side-fetch SSRF.
- **Pure function, never a writer.** `brace-extractor` takes
  `POST { urls } → [{ url, ok, title?, image?, readMode?, error? }]` — a **per-URL
  result array** (partial success, never all-or-nothing, so each link's facet records
  its own `done` / `failed` / `permanent`) — **plaintext**, and returns it to
  the requesting client. The **client** (which holds the data key) does the E2E
  write-back into `links` / `files` / `extraction`. The extractor **holds no key,
  persists nothing, writes no blob** — so what it can leak is transient (a URL it
  saw mid-fetch), not stored. Results it produces carry `extractedBy: 'server'`
  (`tierOf` → server, the lowest quality, above nothing), so any active-page client can
  later **upgrade** them.
- **The preview image is streamed through, never stored.** The metadata response
  carries the og:image as a **URL string** (`{ title, image: url, readMode }`), not
  bytes. That string is enough for an extension/mobile client (it fetches the image
  itself, no CORS), but **not** for the web app — the same wall that sends it to
  `brace-extractor` for the HTML also stops JS reading cross-origin image bytes
  (an `<img>` would _render_ the URL but tainted-canvas / opaque-response block
  reading it into an encryptable blob — and rendering the remote URL _is_ the
  per-paint leak _the preview image is a downloaded blob_ forbids). So
  `brace-extractor` doubles as a **stateless image proxy**: a single interactive
  save **inlines** the image bytes in the extraction response (one round trip); a
  bulk import gets URLs only and the client pulls each image from `GET /image?url=…`,
  which **streams the remote bytes through and buffers/persists nothing**. The
  client encrypts the streamed bytes into `files/{id}.enc` itself. We deliberately
  **don't** have the extractor store the image in R2 and return a signed URL: for a
  one-shot, single-reader download that adds a plaintext-at-rest object, a
  lifecycle/cleanup burden, and _more_ hops
  (fetch→store→GET→re-encrypt→re-upload) — strictly worse than streaming it through
  once (R2's free-egress / CDN benefit needs repeated reads, which this isn't). The
  image fetch is an arbitrary-URL fetch like the HTML, so it carries the **same SSRF
  guard + size/time/`content-type: image/*` caps**. The extractor **never resizes or
  transcodes** — that would force a full-image decode (real CPU + the 128 MB isolate,
  risking OOM) and kill the streaming-is-free property that makes the proxy cheap; any
  thumbnailing is a deferred **client** step done before encrypt, which is also where
  it belongs to bound the storage quota (a capped-dimension re-encode, not the
  full-res original).
- **Anonymous, not session-bound.** Requiring a logged-in session id would
  convert the leak from "the server saw this URL" into "the server can tie this
  URL to _this account_" — a **strictly worse** leak than the one this whole doc
  is built to avoid. So v1 is **anonymous**: IP-based rate limiting (already in
  place) plus an SSRF guard and strict size/time caps; the extractor never learns
  _who_ is asking. The abuse-control upgrade that **preserves** anonymity is blind
  capability tokens (Privacy Pass / VOPRF): `api.brace.to` issues unlinkable
  tokens to real logged-in users, `extractor.brace.to` verifies validity without
  learning which user — deferred, documented as the direction.
- **Abuse caps are load-bearing, not a v2 nicety.** An anonymous endpoint that
  fetches any URL and streams bytes is an **open proxy / DDoS reflector / bandwidth
  amplifier** by default, and the binary image proxy widens that surface past the
  HTML path. So the caps are part of v1, not hardening-later: a hard **per-response
  byte ceiling** (abort the stream once exceeded — never relay a 4 GB file), a
  **timeout**, a **`content-type` allowlist** (`text/html` for extraction, `image/*`
  for the proxy), and a **per-IP egress budget**. IP rate-limiting alone is weak
  (botnets, shared NAT) — which is the real argument for prioritizing the Privacy
  Pass token path above, not deferring it forever. And the SSRF guard's teeth are
  **redirect handling**, not just the sandbox: a public URL can `30x` →
  `127.0.0.1` / `169.254.169.254`, and decimal/hex-encoded IPs or non-`http(s)`
  schemes slip naive checks — so fetch with `redirect: 'manual'` and re-validate
  **every hop**, on both the HTML fetch and the image proxy.
- **Never log the URL.** The extractor's whole reason to exist is that the URL it
  sees stays transient — so observability must be **aggregate-only** (counts,
  latency, error rates), never the URL itself. This is a config footgun, not a code
  one: the proxy's `?url=` lands in query strings, so default Cloudflare request
  logs / Logpush would **persist** exactly the URLs the design promises not to
  retain. Strip them at the edge; if you can't, don't log the request line.

The **app is committed** (a necessary build, see above) and so are the invariants
(separate app, separate origin, anonymous, plaintext-return-only, stream-don't-store,
never-log-the-URL); what stays
**off by default** is the _feature_ — server extraction never runs until the user
takes the second, explicit opt-in.

### the web-only gap (a conscious stance)

A user on **`brace-web` only** — no extension, no phone — **and opted out of
server extraction** gets **no enrichment**: a saved link stays a bare URL with
whatever title they typed. (Opted _in_, the web app orchestrates `brace-extractor`
at save time — see _who extracts_ — and there is no gap; that is the escape hatch
below, realized.) Opted out, the gap is the direct, intended consequence of
"clients do the work, the server stays blind." It is **not** a bug to paper over:

- it keeps the default maximally private (nothing fetches your URLs until you
  install a client that does it locally);
- it's a gentle nudge toward the extension, which is the best extractor anyway
  (active-tab DOM + screenshot);
- the link-editor popover's promise that "the title is back-filled later" simply
  doesn't apply to this user — they only ever have the title they entered.

For this user the escape hatch is the **server extraction** path — a separate
`brace-extractor` app on its own origin (see _server extraction_) — a separate,
explicit opt-in, never the default. The app itself is a committed build (it's how
web/desktop users get any enrichment at all now that the extension is
active-context only); the _gap_ is simply what remains for the user who declines
that opt-in.

### deferred / open

- **Read-mode quality on JS-rendered pages.** Raw-HTML extraction (background
  fetch, or a Worker if ever enabled) is good on server-rendered articles, poor
  on SPAs. Active-tab/WebView extraction (live DOM) is the high-quality path;
  background is best-effort. No fix beyond the tier model — just don't promise
  read-mode parity across tiers.
- **Non-HTML & JS-rendered targets (`brace-extractor`).** Saved URLs aren't all
  server-rendered HTML: PDFs, a direct image (which _is_ the preview), and
  oEmbed-only sites (YouTube/Twitter) each need their own handling, and a JS-shell
  SPA may carry no server-side og tags at all (the extractor runs no JS — `server`
  tier is raw-HTML only). v1 should **detect `content-type` and degrade gracefully**
  (fall back to `title = host`) rather than return garbage; richer per-type handling
  (PDF title, oEmbed, eventual Browser-Rendering JS execution) is the open scope
  call.
- **Re-extract / upgrade UX.** The derived tier (`tierOf(extractedBy)`) _enables_
  upgrading a low-tier result, but the trigger (automatic on a higher-tier sighting vs. a manual
  "re-extract" button) is an open product call.
- **Page copy on background tier.** Capturing a full page copy without an open
  page is the weak spot (offscreen/hidden-tab rendering is heavy and flaky). For
  now the page copy is active-context-only; a headless background capturer is
  deferred.
- **Manual capture.** A user-facing "fetch metadata / capture now" action for
  links that auto-extraction missed (a `failed` link, or a web-only user who
  installs the extension later) — the loop already supports re-running; this just
  exposes a trigger.
