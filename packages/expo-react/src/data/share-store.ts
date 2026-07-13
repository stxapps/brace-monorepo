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
// Drafts are idempotent by construction: the link id (and any new tag's id) is
// minted in the sheet and travels with the draft everywhere, so a retried
// drain (crash between the local write and the file delete) re-writes the same
// entities instead of duplicating. New-tag `rank` is deliberately NOT in the
// draft — it's computed at apply time against the store's current tag set,
// because a rank minted against a stale snapshot could collide with tags
// created since.
//
// Everything that lands in the App Group container is PLAINTEXT BY DESIGN —
// the same trust boundary as the rest of the device store (brace-expo keeps
// content decrypted on device; see architecture.md). clearShareData() is part
// of the sign-out teardown (clear-data.ts) so none of it outlives the session.

import { Platform } from 'react-native';
import { and, gte, lt } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';

import {
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
  rankBetween,
  SYSTEM_LIST_DEFAULTS,
  SYSTEM_LIST_IDS,
  type Tag,
  TAGS_PREFIX,
  tagSchema,
  TRASH_ID,
  type TreeNode,
} from '@stxapps/shared';

import { getDb, items } from './db';
import { getItem } from './item-store';
import { readLocks } from './lock-store';
import { writeExtraction, writeLink, writeTag } from './mutations';
import { parseBlob } from './projection';
import { getSession, loadSession } from './session-store';

// --- shapes -------------------------------------------------------------------

// One Add, as minted by the sheet. `tagIds` is the link's FINAL tag order and
// already includes the ids in `newTags` (which just says which of those must be
// created). `title` is the share payload's page title — it seeds the
// provisional `extraction.title` at apply time, never `customTitle` (the same
// not-a-deliberate-user-title rule as bulk import — shared entities.ts).
const shareDraftSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().optional(),
  listId: z.string().min(1),
  tagIds: z.array(z.string()),
  newTags: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  sharedAt: z.number().int(),
});
export type ShareDraft = z.infer<typeof shareDraftSchema>;

// What the sheet's pickers render. Lists arrive flattened in tree order with
// their indentation `depth` (the sheet has no tree logic); tags in rank order.
const shareTaxonomySchema = z.object({
  sessionPresent: z.boolean(),
  lists: z.array(z.object({ id: z.string(), name: z.string(), depth: z.number().int() })),
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type ShareTaxonomy = z.infer<typeof shareTaxonomySchema>;
export type ShareTaxonomyList = ShareTaxonomy['lists'][number];
export type ShareTaxonomyTag = ShareTaxonomy['tags'][number];

// A signed-out / snapshot-missing taxonomy — what the sheet shows its "open
// Brace and sign in first" state for.
const EMPTY_TAXONOMY: ShareTaxonomy = { sessionPresent: false, lists: [], tags: [] };

// --- pure builders (spec'd in share-store.spec.ts) ------------------------------

// The share sheet's list-picker rows: system defaults overlaid by stored
// overrides (web's mergeSystemLists), tree-ordered and depth-annotated by the
// shared buildTree, minus Trash (saving into the deletion staging area is
// incoherent) and minus locked-hidden subtrees (a `hideList` lock hides the
// list from pickers in-app; the sheet must match — locks gate READING, so
// non-hidden locked lists stay pickable, see docs/share-sheet.md).
export function buildShareLists(
  stored: List[],
  hiddenListIds: ReadonlySet<string>,
): ShareTaxonomyList[] {
  const storedById = new Map(stored.map((list) => [list.id, list]));
  const merged: List[] = SYSTEM_LIST_DEFAULTS.map((def) => storedById.get(def.id) ?? def);
  for (const list of stored) {
    if (!SYSTEM_LIST_IDS.has(list.id)) merged.push(list);
  }
  const rows: ShareTaxonomyList[] = [];
  const walk = (nodes: TreeNode<List>[]) => {
    for (const node of nodes) {
      if (node.item.id === TRASH_ID || hiddenListIds.has(node.item.id)) continue;
      rows.push({ id: node.item.id, name: node.item.name, depth: node.depth });
      walk(node.children);
    }
  };
  walk(buildTree(merged, { noChildrenIds: LIST_NO_CHILDREN_IDS }));
  return rows;
}

// The tag-picker rows, in the user's rank order.
export function buildShareTags(tags: Tag[]): ShareTaxonomyTag[] {
  return tags
    .slice()
    .sort(compareRank)
    .map((tag) => ({ id: tag.id, name: tag.name }));
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

async function readTaxonomyFromDb(): Promise<ShareTaxonomy> {
  const locks = await readLocks();
  const hidden = new Set(
    locks.filter((lock) => lock.kind === 'list' && lock.hideList).map((lock) => lock.id),
  );
  return {
    sessionPresent: true,
    lists: buildShareLists(readNamespace(LISTS_PREFIX, listSchema), hidden),
    tags: buildShareTags(readNamespace(TAGS_PREFIX, tagSchema)),
  };
}

// --- App Group container (iOS) --------------------------------------------------

// expo-share-extension's default group id: `group.` + the bundle identifier
// (app.json `ios.bundleIdentifier`). Falls back to the first container so a
// future explicit AppGroup override doesn't strand this lookup.
const APP_GROUP_ID = 'group.to.brace.app';

function appGroupDir(): Directory | null {
  const containers = Paths.appleSharedContainers;
  const dir = containers[APP_GROUP_ID] ?? Object.values(containers)[0];
  return dir ?? null;
}

function taxonomyFile(group: Directory): File {
  return new File(group, 'share/taxonomy.json');
}

function outboxDir(group: Directory): Directory {
  return new Directory(group, 'share/outbox');
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
// missing session here is a programming error, not a user state.
export async function saveSharedDraft(draft: ShareDraft): Promise<ShareSaveResult> {
  if (Platform.OS === 'ios') {
    const group = appGroupDir();
    if (!group) throw new Error('saveSharedDraft: no App Group container');
    const dir = outboxDir(group);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    new File(dir, `${draft.id}.json`).write(JSON.stringify(draft));
    return 'queued';
  }
  const session = getSession();
  if (!session) throw new Error('saveSharedDraft: no session');
  await applyShareDraft(session.username, draft);
  return 'saved';
}

// --- the main app's half ---------------------------------------------------------

// Land one draft through the write edge: create the new tags (ranked against
// the store's CURRENT tag set, appended at the end), then the link, then seed
// the provisional extraction title. Idempotent per the header: an existing tag
// row short-circuits its create; re-writing the link converges under LWW. A
// listId that stopped existing between share and apply (list deleted on
// another device) falls back to the default inbox rather than dangling.
async function applyShareDraft(username: string, draft: ShareDraft): Promise<void> {
  const existingTags = readNamespace(TAGS_PREFIX, tagSchema);
  let lastRank = existingTags.length
    ? existingTags.slice().sort(compareRank)[existingTags.length - 1].rank
    : null;
  for (const newTag of draft.newTags) {
    if (await getItem(pathFromId(newTag.id, TAGS_PREFIX))) continue;
    const rank = rankBetween(lastRank, null);
    lastRank = rank;
    await writeTag(
      username,
      {
        path: pathFromId(newTag.id, TAGS_PREFIX),
        id: newTag.id,
        name: newTag.name,
        parentId: null,
        rank,
        createdAt: 0,
        updatedAt: 0,
      },
      {},
    );
  }

  const listIds = new Set<string>([
    ...SYSTEM_LIST_IDS,
    ...readNamespace(LISTS_PREFIX, listSchema).map((list) => list.id),
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

// Drain the iOS outbox into the local store — called by the main app on launch
// and foreground (and by the background-task pass). Returns how many drafts
// landed. Each file is deleted only AFTER its local write commits; a corrupt
// file is deleted without applying so it can't wedge the outbox forever. No-op
// when signed out (the drafts wait) or on Android (no outbox exists).
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
    const draft = parseShareDraft(entry.textSync());
    if (draft) {
      await applyShareDraft(session.username, draft);
      applied += 1;
    }
    entry.delete();
  }
  return applied;
}

// Rewrite the iOS taxonomy snapshot from the current store — called by the main
// app whenever lists/tags/locks change and after sign-in/first sync. No-op on
// Android (the share activity reads live) and when signed out (clearShareData
// owns removal).
export async function refreshShareTaxonomy(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!getSession()) return;
  const group = appGroupDir();
  if (!group) return;
  const taxonomy = await readTaxonomyFromDb();
  const file = taxonomyFile(group);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(taxonomy));
}

// Remove everything share-related from the App Group container — part of the
// sign-out teardown (clear-data.ts): the snapshot names the account's lists and
// tags and the outbox may hold undrained URLs, none of which may outlive the
// session or leak to the next account. Failure-tolerant like the rest of the
// teardown's file half.
export function clearShareData(): void {
  if (Platform.OS !== 'ios') return;
  const group = appGroupDir();
  if (!group) return;
  const file = taxonomyFile(group);
  if (file.exists) file.delete();
  const dir = outboxDir(group);
  if (dir.exists) dir.delete();
}
