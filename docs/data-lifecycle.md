## data lifecycle — import, export, delete all data & delete account

The four whole-library actions of the Settings → Data / Account sections and
why each is shaped the way it is. They operate at a different altitude than the
sync plane ([local-first-sync.md](./local-first-sync.md) — individual paths)
and the account plane ([account.md](./account.md) — keys and credentials).

**Where each runs is forced by E2E encryption, not preference.** Import and
export are **client-only** — the server holds only ciphertext, so it _can't_
serialize a bookmarks file or parse one; the plaintext work has to happen where
the key is, and no plaintext ever leaves the device (export writes a local
file, import reads one — the only server traffic is the ordinary sync plane).
Deletion is the one lifecycle action the server _can_ do better than a client
(the envelope — the key prefix — names what to delete, no content knowledge
needed), which is why delete-all is a server endpoint while its predecessors in
the Gaia era were client loops.

The two destructive actions in one view: **delete all data** wipes the bytes
and keeps the identity; **delete account** takes both.

|                      | Delete all data (Settings → Data)               | Delete account (Settings → Account)                     |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| R2 + op log + quota  | wiped                                           | wiped (same service)                                    |
| local store          | synced stores wiped; session/device stores kept | everything wiped (full `clearData` via sign-out)        |
| account rows / doors | untouched                                       | deleted — doors gone = the cryptographic kill           |
| sessions             | kept (you stay signed in)                       | all revoked                                             |
| subscription         | untouched                                       | must not be live (409 gate); canceled-entitled forfeits |
| username             | untouched                                       | tombstoned — occupied forever (loosenable later)        |
| guard                | confirm checkbox                                | fresh password-signed proof + bearer token + checkbox   |
| undo                 | none                                            | none                                                    |

### export — read the local store, apply policy once, serialize per format

`web-react` `data/export.ts` (behind `useExport`) orchestrates; the three
interop serializers are pure functions in `@stxapps/shared` (`export/`). Four
formats, one deliberate asymmetry:

- **brace** — the complete backup: a zip of `manifest.json` + `items.jsonl`
  (raw `{path, data}` entities) + `files/{id}` (raw decrypted blob bytes). The
  **only format that round-trips**, and the only one that includes Trash — a
  backup that silently drops data isn't one.
- **netscape** (browsers, LinkWarden, Karakeep), **csv** (Raindrop.io),
  **text** (URL per line) — the interop formats. Trash is excluded here:
  importing deleted-pending links into a browser as live bookmarks is never
  wanted.

Export reads the **local** store (unsynced edits on this device are included)
after a pre-export sync refresh; a failed refresh downgrades to a warning —
"this is this device's copy" — rather than aborting. The policy that spans all
formats is decided once in the orchestrator: **locked lists are excluded**
(the lock provider's coverage set, descendants included; excluded links drop
with their pins/extractions/files, and the list entities drop too — a hidden
list's _name_ is as sensitive as its contents; the UI warns with the count),
and a dangling `listId` files under My List, the read layer's reconciliation
spirit.

### import — detect the format, land through the write edge

`web-react` `data/import.ts` (behind `useImport`), the write-side mirror: one
entry point takes the picked file, detects the format, and writes through the
normal write edge (`bulkWriteEntities`) — so the pending-ops queue carries an
import to the server **exactly like any other local edit**, and a crash
mid-import loses nothing already written. Detection is two-layered
(`@stxapps/shared` `import/detect.ts`): zip magic first (a brace backup is
bytes; a zip _without_ `manifest.json` has its `.html`/`.csv`/`.txt` entries
parsed and concatenated — Pocket's shutdown export is a zip of `part_*.csv`),
then a content-first text sniff (filenames only break ties — files get renamed
to `.txt` in transit, and a misroute degrades gracefully to the URL-extracting
text parser).

The policy, decided once:

- **Interop imports dedup by canonical URL identity** (`canonicalUrlKey`, the
  same key behind the quick-add duplicate warning) — against the library _and_
  within the file; skips are reported, never errors.
- **The brace backup merges skip-existing by path** — a path already in the
  local store is never touched, so a restore can't clobber newer local edits.
- **The plan's link cap is enforced up front**: if the surviving new links
  would pass `maxLinks`, the import fails _before anything is written_
  (`ImportQuotaError`) — the server hard-enforces the same number at
  `files/sign`, so importing past it would strand local links that can never
  sync.
- A file-carried title is **provisional**: it seeds `extraction.title` (which
  extraction may later upgrade), never `customTitle`.
- Folder paths **find-or-create lists** by case-insensitive name walk; without
  the `nestedLists` entitlement a nested path flattens to one root-level list.
  Trash never matches a folder name.

### delete all data — one server-side wipe, not a client delete loop

`POST /v1/data/delete-all` (contract in `@stxapps/shared` `data/endpoints.ts`,
route in `routes/data.ts`, logic in `services/sync.ts` `deleteAllUserData`).
The old Gaia-era client enumerated fpaths and deleted file-by-file because the
server couldn't be trusted with anything and had no bulk delete. Neither holds
now, and the client-driven loop is wrong on its own terms:

- **it can only delete what it knows about.** Orphans — `object-without-op`
  leftovers, blobs another device pushed that this one never pulled — survive
  it. The server sees the whole `/users/{uid}/` prefix; no client does.
- it would bloat the op log with thousands of `delete` rows and churn the
  pending queue through the engine's single-flight machinery, for minutes
  instead of seconds.

The server needs no content knowledge to do this (everything under the prefix
goes), so it doesn't strain the blind-broker stance — the envelope, not the
ciphertext, names what to delete.

**Ordering: DO first, R2 second.** This is the op-without-object invariant
("the log may lag R2 but must never point ahead of it") read in the delete
direction. Wipe the op log + quota map first (one `wipeAll` RPC — the DO's
serialized SQLite); then page `list()` + `delete()` over the R2 prefix
(1000-key pages, one subrequest each — a 100k-object library is ~200
subrequests in one invocation). A crash between the halves leaves only
objects-without-ops, which the fallback listing heals; the reverse order would
leave surviving put-ops 404ing every puller. Every step is idempotent, so the
recovery story is: the endpoint failed visibly → the user clicks again.

**Multi-device convergence is free — no epoch, no tombstones, no new sync
machinery.** The wiped op log answers the next incremental pull with `null`
bounds, which is already a routing row in the sync design: _cursor set, bounds
null → download-authoritative fallback_. The fallback lists the (now empty) R2
namespace and deletes every local path with no pending op. The one edge:
a device holding **unsynced pending ops pushes them back** (local-wins — the
same policy as every fallback, per "never silently discard the user's unsynced
work"). Accepted and written into the UI copy ("changes that haven't synced yet
may sync back afterward").

**The deleting device** (`web-react` `data/delete-all-data.ts`, over the
`useDeleteAllData` hook):

1. `awaitInflightSync` — wait out any in-flight cycle **without starting one**
   (a cycle that already read the pending queue could re-push ops after the
   wipe), then `clearPendingOps` — this device's unsynced changes are abandoned
   on purpose (pushing them first is work the wipe immediately undoes).
2. Call the endpoint. Nothing local is touched until the server confirms.
3. Wipe the local **synced** stores: `items`, the decode cache, and `locks`
   (they guard lists that no longer exist — the same reset sign-out applies).
4. `seedNewAccount` — cursor back to `(0, '')` with `firstSyncDoneAt` now.
   Semantically exact: an empty local store _is_ the complete snapshot of the
   wiped namespace, the same reasoning that lets create-account seed instead of
   pulling.

What survives, and why: the **session** (staying signed in is the point — this
is the "start over" action, not the "leave" action), the **cached subscription
status** (entitlement is untouched), and **`localSettings`** (theme/layout
device overrides are this device's preferences, not "your data"; the synced
`settings/general.enc` they override _is_ wiped). This is `clearData` minus the
identity/device stores — the two teardowns are cross-referenced in
`clear-data.ts` and must stay aligned when stores are added.

### delete account — the full teardown

`POST /v1/auth/delete-account` (contract beside the other auth endpoints,
service in `services/account.ts` `deleteAccount`). "Deactivate" — a flag that
keeps the ciphertext — was considered and rejected: in a zero-knowledge system
an unused account is already inert (no email, no public surface, only the
key-holder can ever touch the data), so a deactivation flag stops nothing,
while retaining data the user asked to remove violates the privacy stance. And
"no undo but data kept" is the worst combination of properties — can't come
back, _and_ not deleted. So the account action is deletion, done properly.

**Double guard.** The route requires the bearer token (names the account) AND
a fresh signed proof (`action: 'delete-account'`, the same
`verifyAuthProof` machinery as sign-in) — the user re-enters their password,
the client unwraps the DEK and signs. A stolen session token alone can never
erase an account. The service then binds the proof to the session (the signed
username must resolve to the authed userId — a valid proof for account A on a
session for account B dies) and runs the same load-bearing check as sign-in:
the proof's `publicKey` must equal the **stored** credential.

**Subscription gate.** 409 `subscription_active` while the subscription would
keep billing — `status === 'grace'` (dunning: the provider is still retrying
charges) or `willRenew`. Cancellation happens in the Paddle portal
(`POST /v1/iap/portal`), never inside the deletion call — deletion must not
mutate provider state. A **canceled-but-still-entitled** subscription passes:
billing already ended, and holding deletion hostage until the paid period runs
out would be hostile; the remaining time is forfeited (the UI says so). The
client pre-warns from the cached entitlements read, but the server check is
the gate.

**Teardown order — every crash window is finishable by retrying with the
still-live session** (which is why sessions go last), and every step is
idempotent:

1. **Wipe the data plane** — the same `deleteAllUserData` as delete-all.
2. **Tombstone the username** — `deleted_at` set on the directory row, row
   kept. From here sign-in is already refused (opaquely — a tombstone answers
   exactly like a name that never existed on the pre-auth door fetch and
   sign-in).
3. **Delete doors + user row** — one atomic shard `batch`, the same
   all-or-nothing pairing create-account writes them with. Doors gone = the
   **cryptographic kill**: no wrapped DEK survives, so any stray ciphertext is
   permanently unreadable even if a copy escaped deletion.
4. **Revoke every session** (`sessions.deleteByUserId`).

The tombstone lands _before_ the shard delete so the retry path can always
recognize an in-progress deletion: tombstoned entry + missing user row =
resumed teardown (finish the remaining steps; there is no credential left for
the publicKey check to protect); missing user row _without_ a tombstone stays
what it always was — a server-side inconsistency to log and answer opaquely.

**What's deliberately kept:**

- **The username row (tombstoned).** The handle stays occupied forever so
  nobody can re-register it and be mistaken for the previous owner. This is
  the right _default_ because of the asymmetry: a release-after-cooldown
  policy can be added later, but a released name can never be re-occupied.
  ~70 bytes per deleted account, in the directory that outscales the shards
  ~20× anyway.
- **`purchases` rows.** Money-adjacent audit state — a provider id plus our
  random userId, no personal data. Late provider webhooks for a deleted
  account already log-and-drop in `applyPaddleEvent`.

**The deleting client** (`web-react` `hooks/use-delete-account.ts` +
brace-web's Account section): door fetch → `unlockAccount` (the wrong-password
check is the GCM tag, exactly as at sign-in) → sign → POST → `endSession()`,
which runs the full `clearData` wipe and drops the local session; AuthGuard
sends the user home. Typed errors keep the form honest:
`InvalidCredentialsError` → "Incorrect password", `SubscriptionActiveError` →
a pointer at the Subscription section.

### deferred

- **Username release after a cooldown** — loosen the tombstone policy if
  reclaiming handles ever matters; the column (`deleted_at`) already carries
  the timestamp a policy would key on. Loosen-only: never re-tighten.
- **"Sign out everywhere"** — `sessions.deleteByUserId` already exists for the
  teardown; exposing it as a standalone Account action is a cheap, fully
  reversible security control (distinct from deletion, which is why it isn't
  bundled here).
- **Tombstone-teardown sweeper** — a crashed deletion whose session expired
  before a retry leaves a tombstoned name with shard rows still present (data
  already wiped; sign-in already refused). Harmless but untidy; sweep alongside
  the orphan-claim sweeper and `sessions.deleteExpired` when that lands.
