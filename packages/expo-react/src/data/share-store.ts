// The share-sheet data seam — everything the share surface (docs/share-sheet.md)
// exchanges with the rest of the app. The process split drives the design:
//
//  - ANDROID's share activity runs in the app's own process, so it reads the
//    taxonomy live from sqlite and saves through the real write edge
//    (mutations.ts) — the pending op then rides the normal sync drain.
//  - iOS's share extension is a SEPARATE process that must not open the app's
//    sqlite (a shared-container file lock invites the 0xdead10cc kill), so it
//    exchanges atomic per-item JSON files in the App Group container instead:
//    it READS a taxonomy snapshot the main app maintains, and WRITES one
//    outbox draft per Add that the main app drains through the same write edge
//    on the next launch/foreground.
//
// Drafts are idempotent by construction: the link id (and any new list's/tag's
// id AND rank) is minted in the sheet and travels with the draft everywhere, so
// a retried drain (crash between the local write and the file delete) and the
// extension's best-effort upload re-write the SAME entities instead of
// duplicating or shuffling. Minting the rank against the sheet's taxonomy
// (live on Android, snapshot on iOS) is safe because a stale-snapshot rank can
// only TIE with a rank minted elsewhere since — the same equal-key case two
// devices inserting concurrently already produce, broken deterministically by
// id in the sort (shared sync/rank.ts), never data loss.
//
// The schemas below carry NO back-compat slack — rank is required wherever it
// appears (no drain-side fallback, no upload-side skip) and `newLists` has no
// `.default([])`. Each of those covered files written by a build predating the
// field, and nothing has shipped, so no such file can exist; the greenfield
// rule is to tighten the schema in place rather than carry compatibility with a
// past that never happened. A payload missing either is therefore corrupt, and
// the parse boundary rejects it like any other malformed input. Both are worth
// revisiting the day a build ships: an outbox draft or snapshot CAN outlive an
// app update, which is the skew these once guarded.
//
// Everything that lands in the App Group container is PLAINTEXT BY DESIGN —
// the same trust boundary as the rest of the device store (brace-expo keeps
// content decrypted on device; see architecture.md). clearShareData() is part
// of the sign-out teardown (clear-data.ts) so none of it outlives the session.

import { Platform } from 'react-native';
import { and, gte, lt } from 'drizzle-orm';
import { Directory, File } from 'expo-file-system';
import { z } from 'zod';

import {
  type ApiClient,
  buildTree,
  cleanTitle,
  compareRank,
  DEFAULT_LIST_ID,
  LINKS_PREFIX,
  type List,
  LIST_NO_CHILDREN_IDS,
  LISTS_PREFIX,
  listSchema,
  pathFromId,
  SYSTEM_LIST_DEFAULTS,
  SYSTEM_LIST_IDS,
  type Tag,
  TAGS_PREFIX,
  tagSchema,
  TRASH_ID,
  type TreeNode,
} from '@stxapps/shared';

import { runIncrementalSync } from '../sync/engine';
import { appGroupDir } from './app-group';
import { getDb, items } from './db';
import { getItem } from './item-store';
import { writeExtraction, writeLink, writeList, writeTag } from './mutations';
import { parseBlob } from './projection';
import { getSession, loadSession, loadSharedSession } from './session-store';
import { uploadShareDraft } from './share-upload';

// --- shapes -------------------------------------------------------------------

// A list/tag the sheet minted for creation at apply time. `rank` is minted in
// the sheet too (from the taxonomy's neighbour ranks — see the header on why a
// stale rank is only a tie), so the upload and the drain write identical
// entities from the draft alone. Required: the sheet mints against the taxonomy
// it already renders its pickers from, so a rank-free entry can only be corrupt.
const shareNewEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rank: z.string().min(1),
});
export type ShareNewEntity = z.infer<typeof shareNewEntitySchema>;

// One Add, as minted by the sheet. `tagIds` is the link's FINAL tag order and
// already includes the ids in `newTags` (which just says which of those must be
// created). `newLists` is the list counterpart — at most one in practice (the
// sheet's create-and-select), `parentId` pinned null at apply (the editors'
// top-level-only create rule — docs/editors.md). It carries no `.default([])`,
// for the same reason `rank` above is required: the default only ever covered
// drafts from a build predating the field, and no such build shipped. `title`
// is the share payload's page title — it seeds the provisional
// `extraction.title` at apply time, never `customTitle` (the same
// not-a-deliberate-user-title rule as bulk import — shared entities.ts).
const shareDraftSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().optional(),
  listId: z.string().min(1),
  tagIds: z.array(z.string()),
  newTags: z.array(shareNewEntitySchema),
  newLists: z.array(shareNewEntitySchema),
  sharedAt: z.number().int(),
});
export type ShareDraft = z.infer<typeof shareDraftSchema>;

// What the sheet's pickers render. Lists arrive flattened in tree order with
// their indentation `depth` (the sheet has no tree logic); tags in rank order.
// `rank` rides along so the sheet can mint the neighbour rank for what it
// creates — index 0 for both entities (docs/editors.md). Required: the snapshot
// is rewritten from the store by refreshShareTaxonomy, which always has ranks,
// so a rank-free row means a corrupt file — and reading THAT as signed-out is
// the right answer, since it points the user at the app, which rewrites it.
const shareTaxonomySchema = z.object({
  sessionPresent: z.boolean(),
  lists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      depth: z.number().int(),
      rank: z.string(),
    }),
  ),
  tags: z.array(z.object({ id: z.string(), name: z.string(), rank: z.string() })),
});
export type ShareTaxonomy = z.infer<typeof shareTaxonomySchema>;
export type ShareTaxonomyList = ShareTaxonomy['lists'][number];
export type ShareTaxonomyTag = ShareTaxonomy['tags'][number];

// A signed-out / snapshot-missing taxonomy — what the sheet shows its "open
// Brace and sign in first" state for.
const EMPTY_TAXONOMY: ShareTaxonomy = { sessionPresent: false, lists: [], tags: [] };

// --- pure builders (spec'd in share-store.spec.ts) ------------------------------

// System defaults overlaid by stored overrides — web's mergeSystemLists, shared
// by the picker-row builder and the drain's rank/validity reads.
function mergeSystemLists(stored: List[]): List[] {
  const storedById = new Map(stored.map((list) => [list.id, list]));
  const merged: List[] = SYSTEM_LIST_DEFAULTS.map((def) => storedById.get(def.id) ?? def);
  for (const list of stored) {
    if (!SYSTEM_LIST_IDS.has(list.id)) merged.push(list);
  }
  return merged;
}

// The share sheet's list-picker rows: merged system+user lists, tree-ordered
// and depth-annotated by the shared buildTree, minus Trash ONLY (saving into
// the deletion staging area is incoherent). Deliberately NOT filtered by the
// lock model: hide is a pure sidebar declutter and a lock gates a list's
// CONTENTS, never its use as a destination — the same only-Trash rule every
// editor picker follows (docs/editors.md, "Locked and hidden lists stay
// pickable"). Don't re-add a hiddenListIds filter here.
export function buildShareLists(stored: List[]): ShareTaxonomyList[] {
  const rows: ShareTaxonomyList[] = [];
  const walk = (nodes: TreeNode<List>[]) => {
    for (const node of nodes) {
      if (node.item.id === TRASH_ID) continue;
      rows.push({
        id: node.item.id,
        name: node.item.name,
        depth: node.depth,
        rank: node.item.rank,
      });
      walk(node.children);
    }
  };
  walk(buildTree(mergeSystemLists(stored), { noChildrenIds: LIST_NO_CHILDREN_IDS }));
  return rows;
}

// The tag-picker rows, in the user's rank order.
export function buildShareTags(tags: Tag[]): ShareTaxonomyTag[] {
  return tags
    .slice()
    .sort(compareRank)
    .map((tag) => ({ id: tag.id, name: tag.name, rank: tag.rank }));
}

// Defensive parses for what crosses the App Group container (the other process
// may be an older/newer build): null on any malformed payload.
export function parseShareDraft(raw: string): ShareDraft | null {
  try {
    const parsed = shareDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseShareTaxonomy(raw: string): ShareTaxonomy | null {
  try {
    const parsed = shareTaxonomySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// --- db reads (Android live path + the iOS snapshot builder) -------------------

// Decode every entity under a namespace prefix — the minimal ancestor of web's
// readNamespace, scoped to what the share surface needs until the expo read
// edge lands. The prefix range-scans the primary key; lists/tags are small by
// design, so decoding the whole namespace is cheap.
function readNamespace<T extends z.ZodTypeAny>(prefix: string, schema: T): z.infer<T>[] {
  // Half-open key range [prefix, prefix + ￿) — the sqlite spelling of
  // Dexie's `where('path').startsWith(prefix)` (namespace ids are ASCII, so
  // nothing sorts at or above ￿).
  const rows = getDb()
    .select()
    .from(items)
    .where(and(gte(items.path, prefix), lt(items.path, `${prefix}￿`)))
    .all();
  const decoded: z.infer<T>[] = [];
  for (const row of rows) {
    const entity = parseBlob(row.data ?? undefined, schema);
    if (entity !== undefined) decoded.push(entity);
  }
  return decoded;
}

function readTaxonomyFromDb(): ShareTaxonomy {
  return {
    sessionPresent: true,
    lists: buildShareLists(readNamespace(LISTS_PREFIX, listSchema)),
    tags: buildShareTags(readNamespace(TAGS_PREFIX, tagSchema)),
  };
}

// --- App Group container (iOS) --------------------------------------------------

// Everything this module owns lives under one subtree, so the sign-out teardown
// can remove it wholesale rather than enumerating artifacts (clearShareData).
function shareDir(group: Directory): Directory {
  return new Directory(group, 'share');
}

function taxonomyFile(group: Directory): File {
  return new File(group, 'share/taxonomy.json');
}

function outboxDir(group: Directory): Directory {
  return new Directory(group, 'share/outbox');
}

// Where an outbox file the drain couldn't read goes (see drainShareOutbox). A
// SIBLING of the outbox, not a child: the drain must never see it again, and
// nesting it would make that depend on the scan skipping directories.
function failedDir(group: Directory): Directory {
  return new Directory(group, 'share/failed');
}

// --- the sheet's surface ---------------------------------------------------------

// What the share sheet renders its pickers from. iOS: the snapshot (missing/
// stale-schema snapshot reads as signed-out — the sheet then points at the app).
// Android: hydrate the session mirror (this may be the process's first code to
// run) and read live.
export async function loadShareTaxonomy(): Promise<ShareTaxonomy> {
  if (Platform.OS === 'ios') {
    const group = appGroupDir();
    if (!group) return EMPTY_TAXONOMY;
    const file = taxonomyFile(group);
    if (!file.exists) return EMPTY_TAXONOMY;
    return parseShareTaxonomy(file.textSync()) ?? EMPTY_TAXONOMY;
  }
  await loadSession();
  if (!getSession()) return EMPTY_TAXONOMY;
  return readTaxonomyFromDb();
}

export type ShareSaveResult =
  // Android: written through the real write edge; the pending op syncs on the
  // next engine cycle.
  | 'saved'
  // iOS: parked in the App Group outbox; the main app drains it on next
  // launch/foreground.
  | 'queued';

// One Add. The sheet checks `sessionPresent` before offering the form, so a
// missing session here is a programming error, not a user state. `api` is the
// app's configured client (the sheet passes it in — the baseUrl binding lives
// in the app, per the layering rules); it powers the post-write kick on both
// platforms. THE KICK IS NEVER AWAITED (docs/share-sheet.md): the durable
// commit is the local write / outbox file, so Add resolves as soon as that
// lands and the sheet shows ✓ — delivery is guaranteed by the pending op /
// next-open drain, not by the in-flight network work surviving the dismissal.
export async function saveSharedDraft(draft: ShareDraft, api: ApiClient): Promise<ShareSaveResult> {
  if (Platform.OS === 'ios') {
    const group = appGroupDir();
    if (!group) throw new Error('saveSharedDraft: no App Group container');
    const dir = outboxDir(group);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    new File(dir, `${draft.id}.json`).write(JSON.stringify(draft));
    // Best-effort encrypt + PUT on top of the durable outbox write
    // (share-upload.ts) — buys cross-device freshness when it lands, loses
    // nothing when it doesn't (offline, no mirrored session, process reaped
    // after close()): the drain re-uploads the same ids and LWW converges.
    void uploadQueuedDraft(api, draft);
    return 'queued';
  }
  const session = getSession();
  if (!session) throw new Error('saveSharedDraft: no session');
  await applyShareDraft(session.username, draft);
  // Inline sync kick: the pending op usually lands server-side while the share
  // activity's process is still alive (one entity, sub-second). Un-awaited JS
  // on the app-level React host IS the doc's "application/process scope" — the
  // activity's finish() doesn't cancel it; only a process reap does, and that
  // loss is covered by the pending op + the app's next sync cycle.
  void runIncrementalSync({
    username: session.username,
    encryptionKey: session.encryptionKey,
    api,
  }).catch(() => undefined);
  return 'saved';
}

// The iOS extension's fire-and-forget half of saveSharedDraft. Hydrates the
// session from the shared-Keychain mirror (the extension runs no AuthProvider —
// this is also what arms the api client's bearer token), skips when the token
// has lapsed (the PUT would just 401), and swallows every failure: the outbox
// file already written is the record of truth.
async function uploadQueuedDraft(api: ApiClient, draft: ShareDraft): Promise<void> {
  try {
    const session = await loadSharedSession();
    if (!session || session.expiresAt <= Date.now()) return;
    await uploadShareDraft({ encryptionKey: session.encryptionKey, api }, draft);
  } catch {
    // Best-effort by design — the main app drains the outbox on next open.
  }
}

// --- the main app's half ---------------------------------------------------------

// Land one draft through the write edge: create the new lists (top-level, the
// editors' `parentId: null` rule), then the new tags, then the link, then seed
// the provisional extraction title. Ranks come from the draft VERBATIM — minted
// in the sheet (see the header), which keeps this byte-identical with what the
// extension may have already uploaded, so LWW converges without shuffling
// anyone's order. Idempotent per the header: an existing row short-circuits its
// create; re-writing the link converges under LWW. A listId that stopped
// existing between share and apply (list deleted on another device) falls back
// to the default inbox rather than dangling.
async function applyShareDraft(username: string, draft: ShareDraft): Promise<void> {
  const storedLists = readNamespace(LISTS_PREFIX, listSchema);

  for (const newList of draft.newLists) {
    if (await getItem(pathFromId(newList.id, LISTS_PREFIX))) continue;
    await writeList(
      username,
      {
        path: pathFromId(newList.id, LISTS_PREFIX),
        id: newList.id,
        name: newList.name,
        parentId: null,
        rank: newList.rank,
        createdAt: 0,
        updatedAt: 0,
      },
      {},
    );
  }

  for (const newTag of draft.newTags) {
    if (await getItem(pathFromId(newTag.id, TAGS_PREFIX))) continue;
    await writeTag(
      username,
      {
        path: pathFromId(newTag.id, TAGS_PREFIX),
        id: newTag.id,
        name: newTag.name,
        parentId: null,
        rank: newTag.rank,
        createdAt: 0,
        updatedAt: 0,
      },
      {},
    );
  }

  const listIds = new Set<string>([
    ...SYSTEM_LIST_IDS,
    ...storedLists.map((list) => list.id),
    ...draft.newLists.map((list) => list.id),
  ]);
  const listId =
    listIds.has(draft.listId) && draft.listId !== TRASH_ID ? draft.listId : DEFAULT_LIST_ID;

  await writeLink(
    username,
    {
      path: pathFromId(draft.id, LINKS_PREFIX),
      url: draft.url,
      listId,
      tagIds: draft.tagIds,
      createdAt: 0,
      updatedAt: 0,
    },
    {},
  );

  const title = cleanTitle(draft.title);
  if (title !== undefined) {
    await writeExtraction(username, draft.id, { fields: { title } });
  }
}

// Read + parse one outbox file. Null when the bytes are unreadable OR the JSON
// doesn't match the schema — the caller treats both the same, since neither can
// be applied, and a file that throws on read would otherwise abort the whole
// drain and strand every draft behind it.
function readDraft(entry: File): ShareDraft | null {
  try {
    return parseShareDraft(entry.textSync());
  } catch {
    return null;
  }
}

// Park an unreadable outbox file out of the drain's path (see drainShareOutbox).
// Best-effort: if the move itself fails, leaving the file in the outbox is the
// least-bad outcome — the next drain retries it, and it blocks nothing in the
// meantime (the loop moves on to the next file either way).
function quarantine(group: Directory, entry: File): void {
  try {
    const dir = failedDir(group);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    entry.move(dir);
  } catch {
    // Leave it where it is; the next drain will try again.
  }
}

// Drain the iOS outbox into the local store — called by the main app on launch
// and foreground (and by the background-task pass). Returns how many drafts
// landed. Each file is deleted only AFTER its local write commits.
//
// A file the drain CAN'T READ is moved to `share/failed/`, never deleted. It
// can't stay in the outbox (it would be retried forever), but destroying it is
// worse: an outbox draft is sometimes the ONLY copy of a share — the
// best-effort upload fails exactly when the user was offline — and the drafts
// most likely to stop parsing are the ones written by an older build, since a
// parked file outlives the code that wrote it and the schemas here carry no
// back-compat slack (see the header). Quarantining keeps that class of mistake
// a recoverable bug report instead of a link the user silently never gets back.
// Nothing reads `failed/` today; sign-out clears it with everything else
// (clearShareData).
//
// No-op when signed out (the drafts wait) or on Android (no outbox exists).
export async function drainShareOutbox(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;
  const session = getSession();
  if (!session) return 0;
  const group = appGroupDir();
  if (!group) return 0;
  const dir = outboxDir(group);
  if (!dir.exists) return 0;
  let applied = 0;
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    const draft = readDraft(entry);
    if (!draft) {
      quarantine(group, entry);
      continue;
    }
    await applyShareDraft(session.username, draft);
    applied += 1;
    entry.delete();
  }
  return applied;
}

// Rewrite the iOS taxonomy snapshot from the current store — called by the main
// app whenever lists/tags change and after sign-in/first sync. No-op on
// Android (the share activity reads live) and when signed out (clearShareData
// owns removal).
export async function refreshShareTaxonomy(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!getSession()) return;
  const group = appGroupDir();
  if (!group) return;
  const taxonomy = readTaxonomyFromDb();
  const file = taxonomyFile(group);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(taxonomy));
}

// Remove everything share-related from the App Group container — part of the
// sign-out teardown (clear-data.ts): the snapshot names the account's lists and
// tags, and the outbox (plus its `failed/` quarantine) may hold undrained URLs,
// none of which may outlive the session or leak to the next account. Deletes the
// whole `share/` subtree rather than naming each artifact, so anything added
// under it later is covered by construction — an enumeration here is exactly the
// kind of list that silently misses the next addition. Failure-tolerant like the
// rest of the teardown's file half.
export function clearShareData(): void {
  if (Platform.OS !== 'ios') return;
  const group = appGroupDir();
  if (!group) return;
  const dir = shareDir(group);
  if (dir.exists) dir.delete();
}
