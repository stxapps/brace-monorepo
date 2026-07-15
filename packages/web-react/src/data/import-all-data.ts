'use client';

// Import-all-data orchestrator — the Settings → Data → Import action behind
// useImportAllData (hooks/use-import-all-data.ts), and the write-side mirror of
// export-all-data.ts. One entry point takes the picked File, detects its format,
// and lands everything in the LOCAL store through the write edge
// (bulkWriteEntities), so the durable pending-ops queue carries the import to
// the server exactly like any other local edit — the caller kicks a sync when
// the run finishes.
//
//   brace     — the re-importable backup zip export-all-data.ts produced
//               (manifest.json + items.jsonl + files/{id}): raw entities
//               restored VERBATIM under their original paths, timestamps
//               preserved.
//   netscape / csv / text — the interop formats: parsed rows (the pure parsers
//               in @stxapps/shared import/) become NEW links, their folders and
//               tag names resolved against — or created in — this library. A
//               zip WITHOUT manifest.json routes here too — its .html/.csv/.txt
//               entries are parsed and concatenated (Pocket's shutdown export
//               is a zip of part_*.csv files).
//
// POLICY (decided here, once):
//   - Interop imports SKIP DUPLICATES by the canonical URL identity
//     (canonicalUrlKey — the same key behind the quick-add duplicate warning),
//     both against the library and within the file; skips are reported, never
//     errors.
//   - The brace backup merges SKIP-EXISTING by path: a path already in the local
//     store is never touched, so a restore can't clobber newer local edits.
//   - The plan's link cap is enforced UP FRONT: if the surviving new links would
//     push the library past `maxLinks`, the import fails BEFORE anything is
//     written (ImportQuotaError). The server hard-enforces the same number at
//     `files/sign`, so importing past it would strand local links that can never
//     sync.
//   - A file-carried title is PROVISIONAL, not deliberate: it seeds
//     `extraction.title` (which extraction may later upgrade), never
//     `customTitle` — see the contract note in @stxapps/shared sync/entities.ts.
//   - Folder paths find-or-create lists by case-insensitive name walk; without
//     the nestedLists entitlement a nested path flattens to ONE root-level list
//     named by the slash-joined path (the CSV `folder` column's own shape).
//     Trash never matches a folder name — importing live bookmarks as
//     deleted-pending links is never wanted.

// Type-only — erased at compile time, so zip.js itself stays lazily imported.
import type { FileEntry } from '@zip.js/zip.js';

import type { Extraction, Link, List, Tag } from '@stxapps/shared';
import {
  canonicalUrlKey,
  cleanTitle,
  compareRank,
  detectTextImportFormat,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  FILES_PREFIX,
  idFromPath,
  type ImportedLink,
  isZipBytes,
  LINK_NOTE_MAX,
  LINKS_PREFIX,
  linkSchema,
  LISTS_PREFIX,
  listSchema,
  MY_LIST_ID,
  parseNetscapeHtml,
  parseRaindropCsv,
  parseUrlText,
  pathFromId,
  PINS_PREFIX,
  pinSchema,
  rankForIndex,
  SETTINGS_GENERAL_PATH,
  settingsGeneralSchema,
  TAGS_PREFIX,
  tagSchema,
  TRASH_ID,
} from '@stxapps/shared';
import { newId } from '@stxapps/web-crypto';

import { runIncrementalSync, type SyncDeps } from '../sync/engine';
import { db } from './db';
import { BRACE_BACKUP_FORMAT, BRACE_BACKUP_VERSION } from './export-all-data';
import { bulkWriteEntities, type RawEntityEntry } from './mutations';
import { readLists, readTags } from './queries';

// The running phases, in order. `sync` and `parse` are indeterminate; `items`
// counts entity writes, `files` counts blob restores (brace only).
export interface ImportProgress {
  step: 'sync' | 'parse' | 'items' | 'files';
  done?: number;
  total?: number;
}

export interface ImportOutcome {
  // Links written (new links; skips and invalid rows are counted separately).
  linkCount: number;
  // Lists / tags newly created (interop) or restored (brace).
  listCount: number;
  tagCount: number;
  // `files/` blobs restored from the zip (brace only; 0 otherwise).
  fileCount: number;
  // Interop: URLs skipped as already saved (or repeated in the file).
  // Brace: entities skipped because their path already exists locally.
  skippedCount: number;
  // Rows/lines that didn't parse or validate — reported, never fatal.
  invalidCount: number;
  // The pre-import refresh failed (offline / server down); the import carried on
  // against this device's local copy. A warning, not an error — local-first.
  syncFailed: boolean;
}

// The plan's link cap would be exceeded — thrown BEFORE anything is written.
// The message is user-facing (the import view renders it verbatim).
export class ImportQuotaError extends Error {
  constructor(newCount: number, existingCount: number, maxLinks: number) {
    super(
      `Importing ${newCount} new ${newCount === 1 ? 'link' : 'links'} would exceed your ` +
        `plan's limit of ${maxLinks} links (you have ${existingCount}). ` +
        'Upgrade your plan or import fewer links.',
    );
    this.name = 'ImportQuotaError';
  }
}

// Writes land in bounded transactions so IndexedDB isn't asked for one
// transaction per link and progress can tick between chunks.
const WRITE_CHUNK = 200;

// --- the existing library (what dedupe/quota/skip-existing check against) -------

interface ExistingLinks {
  count: number;
  ids: Set<string>;
  // canonicalUrlKey per link (falling back to the exact stored URL when the key
  // can't be derived — same fallback readLinkByUrlKey makes), off the projected
  // index columns, no blob decode.
  urlKeys: Set<string>;
}

async function readExistingLinks(): Promise<ExistingLinks> {
  const records = await db.items.where('path').startsWith(LINKS_PREFIX).toArray();
  const ids = new Set<string>();
  const urlKeys = new Set<string>();
  for (const record of records) {
    ids.add(idFromPath(record.path, LINKS_PREFIX));
    const key = record.itemUrlKey ?? record.itemUrl;
    if (key !== undefined) urlKeys.add(key);
  }
  return { count: records.length, ids, urlKeys };
}

function assertUnderQuota(
  newLinkCount: number,
  existingCount: number,
  maxLinks: number | null,
): void {
  if (maxLinks !== null && existingCount + newLinkCount > maxLinks) {
    throw new ImportQuotaError(newLinkCount, existingCount, maxLinks);
  }
}

// --- interop: folder → list and tag-name → id resolution ------------------------

// Find-or-create lists for the parsed folder paths. Stateful over one run: the
// sibling groups (sorted like the sidebar) grow as folders are created, so a
// second link into the same new folder reuses it and ranks stay monotonic.
class ListResolver {
  private childrenOf = new Map<string | null, { id: string; name: string; rank: string }[]>();
  private resolved = new Map<string, string>();
  readonly created: RawEntityEntry[] = [];
  private readonly now: number;

  constructor(
    lists: { id: string; name: string; parentId: string | null; rank: string }[],
    now: number,
  ) {
    this.now = now;
    for (const list of lists) {
      const siblings = this.childrenOf.get(list.parentId) ?? [];
      siblings.push(list);
      this.childrenOf.set(list.parentId, siblings);
    }
    for (const siblings of this.childrenOf.values()) siblings.sort(compareRank);
  }

  resolve(folderPath: string[]): string {
    if (folderPath.length === 0) return MY_LIST_ID;
    const memoKey = folderPath.join('\u0000');
    const memoized = this.resolved.get(memoKey);
    if (memoized !== undefined) return memoized;

    let parentId: string | null = null;
    let listId = MY_LIST_ID;
    for (const segment of folderPath) {
      const siblings = this.childrenOf.get(parentId) ?? [];
      this.childrenOf.set(parentId, siblings);
      const wanted = segment.toLowerCase();
      // Trash is excluded from matching — a folder named "Trash" becomes a
      // regular list rather than mapping links into deletion staging.
      const match = siblings.find(
        (list) => list.id !== TRASH_ID && list.name.trim().toLowerCase() === wanted,
      );
      if (match) {
        listId = match.id;
      } else {
        const list: List = {
          id: newId(),
          name: segment,
          parentId,
          rank: rankForIndex(siblings, siblings.length),
          createdAt: this.now,
          updatedAt: this.now,
        };
        this.created.push({ path: pathFromId(list.id, LISTS_PREFIX), data: list });
        siblings.push({ id: list.id, name: list.name, rank: list.rank });
        listId = list.id;
      }
      parentId = listId;
    }
    this.resolved.set(memoKey, listId);
    return listId;
  }
}

// Find-or-create tags by case-insensitive name. New tags are root-level,
// appended after the existing root siblings in rank order.
class TagResolver {
  private idByName = new Map<string, string>();
  private rootSiblings: { id: string; rank: string }[];
  readonly created: RawEntityEntry[] = [];
  private readonly now: number;

  constructor(
    tags: { id: string; name: string; parentId: string | null; rank: string }[],
    now: number,
  ) {
    this.now = now;
    for (const tag of tags) this.idByName.set(tag.name.trim().toLowerCase(), tag.id);
    this.rootSiblings = tags.filter((tag) => tag.parentId === null).sort(compareRank);
  }

  resolve(names: string[]): string[] {
    const ids: string[] = [];
    for (const name of names) {
      const wanted = name.trim().toLowerCase();
      if (wanted === '') continue;
      let id = this.idByName.get(wanted);
      if (id === undefined) {
        const tag: Tag = {
          id: newId(),
          name: name.trim(),
          parentId: null,
          rank: rankForIndex(this.rootSiblings, this.rootSiblings.length),
          createdAt: this.now,
          updatedAt: this.now,
        };
        this.created.push({ path: pathFromId(tag.id, TAGS_PREFIX), data: tag });
        this.rootSiblings.push({ id: tag.id, rank: tag.rank });
        this.idByName.set(wanted, tag.id);
        id = tag.id;
      }
      // A link's tag set — repeated names in one row collapse.
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
}

// --- interop: parsed rows → new entities -----------------------------------------

async function importInterop(
  username: string,
  parsed: ImportedLink[],
  maxLinks: number | null,
  nestedLists: boolean,
  onProgress: (progress: ImportProgress) => void,
): Promise<Omit<ImportOutcome, 'syncFailed'>> {
  const existing = await readExistingLinks();

  // Dedupe against the library and within the file, by canonical identity.
  const seen = new Set(existing.urlKeys);
  const rows: ImportedLink[] = [];
  for (const row of parsed) {
    const key = canonicalUrlKey(row.url) ?? row.url;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const skippedCount = parsed.length - rows.length;

  assertUnderQuota(rows.length, existing.count, maxLinks);

  const now = Date.now();
  const lists = new ListResolver(await readLists(), now);
  const tags = new TagResolver(await readTags(), now);

  let invalidCount = 0;
  let linkCount = 0;
  const linkEntries: RawEntityEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Undated rows get descending stamps from `now`, so the file's order IS the
    // library's newest-first display order after import.
    const createdAt = row.createdAt ?? now - i;
    const updatedAt = Math.max(row.updatedAt ?? createdAt, createdAt);
    const folderPath = nestedLists
      ? row.folderPath
      : row.folderPath.length > 0
        ? [row.folderPath.join('/')]
        : [];

    const id = newId();
    const link: Link = {
      url: row.url,
      listId: lists.resolve(folderPath),
      tagIds: tags.resolve(row.tagNames),
      createdAt,
      updatedAt,
    };
    if (row.note !== undefined) link.note = row.note.slice(0, LINK_NOTE_MAX);
    if (!linkSchema.safeParse(link).success) {
      invalidCount += 1;
      continue;
    }
    linkEntries.push({ path: pathFromId(id, LINKS_PREFIX), data: link });
    linkCount += 1;

    const title = cleanTitle(row.title);
    if (title !== undefined) {
      const extraction: Extraction = { id, title, facets: {}, createdAt, updatedAt };
      if (extractionSchema.safeParse(extraction).success) {
        linkEntries.push({ path: pathFromId(id, EXTRACTIONS_PREFIX), data: extraction });
      }
    }
  }

  // Lists and tags land first so no chunk boundary leaves a link pointing at a
  // list/tag that isn't stored yet (a dangling ref is survivable, but free to
  // avoid here). Progress counts entity writes.
  const entries = [...lists.created, ...tags.created, ...linkEntries];
  onProgress({ step: 'items', done: 0, total: entries.length });
  for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
    await bulkWriteEntities(username, entries.slice(i, i + WRITE_CHUNK));
    onProgress({
      step: 'items',
      done: Math.min(i + WRITE_CHUNK, entries.length),
      total: entries.length,
    });
  }

  return {
    linkCount,
    listCount: lists.created.length,
    tagCount: tags.created.length,
    fileCount: 0,
    skippedCount,
    invalidCount,
  };
}

// --- the brace backup -------------------------------------------------------------

// One items.jsonl line, classified. The schema gate mirrors the read layer's:
// an entity that wouldn't decode there doesn't get imported here.
interface BundleEntry {
  path: string;
  data: object;
  kind: 'link' | 'list' | 'tag' | 'pin' | 'extraction' | 'settings';
}

const BUNDLE_NAMESPACES = [
  { prefix: LINKS_PREFIX, schema: linkSchema, kind: 'link' as const },
  { prefix: LISTS_PREFIX, schema: listSchema, kind: 'list' as const },
  { prefix: TAGS_PREFIX, schema: tagSchema, kind: 'tag' as const },
  { prefix: PINS_PREFIX, schema: pinSchema, kind: 'pin' as const },
  { prefix: EXTRACTIONS_PREFIX, schema: extractionSchema, kind: 'extraction' as const },
];

function classifyBundleLine(line: string): BundleEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { path, data } = parsed as { path?: unknown; data?: unknown };
  if (typeof path !== 'string' || typeof data !== 'object' || data === null) return undefined;

  if (path === SETTINGS_GENERAL_PATH) {
    if (!settingsGeneralSchema.safeParse(data).success) return undefined;
    return { path, data, kind: 'settings' };
  }
  for (const { prefix, schema, kind } of BUNDLE_NAMESPACES) {
    if (!path.startsWith(prefix)) continue;
    // The id between prefix and `.enc` must be a plain token — a malformed path
    // would poison the store/R2 key space.
    const id = path.slice(prefix.length, path.length - '.enc'.length);
    if (!path.endsWith('.enc') || id === '' || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
    if (!schema.safeParse(data).success) return undefined;
    return { path, data, kind };
  }
  return undefined;
}

// Every `files/{id}` zip entry the IMPORTED links/extractions reference —
// referenced-only, mirroring export's referencedFilePaths.
function referencedFileIds(entries: BundleEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'link') {
      const { customImageId } = entry.data as Link;
      if (customImageId !== undefined) ids.add(customImageId);
    } else if (entry.kind === 'extraction') {
      const { imageId, pageCopyId, screenshotId } = entry.data as Extraction;
      if (imageId !== undefined) ids.add(imageId);
      if (pageCopyId !== undefined) ids.add(pageCopyId);
      if (screenshotId !== undefined) ids.add(screenshotId);
    }
  }
  return ids;
}

async function importBraceBackup(
  username: string,
  byName: Map<string, FileEntry>,
  maxLinks: number | null,
  onProgress: (progress: ImportProgress) => void,
): Promise<Omit<ImportOutcome, 'syncFailed'>> {
  // Already loaded by importZip — this re-import just picks the writers off the
  // cached module.
  const { TextWriter, Uint8ArrayWriter } = await import('@zip.js/zip.js');

  const manifestEntry = byName.get('manifest.json');
  if (manifestEntry === undefined) {
    throw new Error('This zip is not a Brace backup (no manifest.json).');
  }
  let manifest: { format?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(await manifestEntry.getData(new TextWriter())) as typeof manifest;
  } catch {
    throw new Error('This zip is not a Brace backup (unreadable manifest).');
  }
  if (manifest.format !== BRACE_BACKUP_FORMAT) {
    throw new Error('This zip is not a Brace backup (unrecognized format).');
  }
  if (typeof manifest.version !== 'number' || manifest.version > BRACE_BACKUP_VERSION) {
    throw new Error(
      'This backup was created by a newer version of Brace. Update the app and try again.',
    );
  }

  const itemsEntry = byName.get('items.jsonl');
  const itemsText = itemsEntry === undefined ? '' : await itemsEntry.getData(new TextWriter());

  let invalidCount = 0;
  const classified: BundleEntry[] = [];
  for (const line of itemsText.split('\n')) {
    if (line.trim() === '') continue;
    const entry = classifyBundleLine(line);
    if (entry === undefined) invalidCount += 1;
    else classified.push(entry);
  }

  // SKIP-EXISTING: a path already in the local store is never touched.
  const existingRecords = await db.items.bulkGet(classified.map((entry) => entry.path));
  let skippedCount = 0;
  const fresh = classified.filter((_, i) => {
    if (existingRecords[i] === undefined) return true;
    skippedCount += 1;
    return false;
  });

  const existing = await readExistingLinks();
  const freshLinks = fresh.filter((entry) => entry.kind === 'link');
  assertUnderQuota(freshLinks.length, existing.count, maxLinks);

  // A pin/extraction whose link is neither imported nor already local is a
  // dangling satellite — drop it rather than restore garbage.
  const linkIds = new Set(existing.ids);
  for (const entry of freshLinks) {
    linkIds.add(idFromPath(entry.path, LINKS_PREFIX));
  }
  const entries = fresh.filter((entry) => {
    if (entry.kind !== 'pin' && entry.kind !== 'extraction') return true;
    const prefix = entry.kind === 'pin' ? PINS_PREFIX : EXTRACTIONS_PREFIX;
    return linkIds.has(idFromPath(entry.path, prefix));
  });

  onProgress({ step: 'items', done: 0, total: entries.length });
  for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
    await bulkWriteEntities(
      username,
      entries.slice(i, i + WRITE_CHUNK).map(({ path, data }) => ({ path, data })),
    );
    onProgress({
      step: 'items',
      done: Math.min(i + WRITE_CHUNK, entries.length),
      total: entries.length,
    });
  }

  // The referenced blobs, one at a time (they can be MB-sized media): only
  // ids with a zip entry and no local record. A ref with no bytes stays a
  // normal not-yet-materialized lazy blob.
  const fileIds = [...referencedFileIds(entries)];
  const filePaths = fileIds.map((id) => pathFromId(id, FILES_PREFIX));
  const localFiles = await db.items.bulkGet(filePaths);
  let fileCount = 0;
  onProgress({ step: 'files', done: 0, total: fileIds.length });
  for (let i = 0; i < fileIds.length; i++) {
    const zipEntry = byName.get(`files/${fileIds[i]}`);
    if (zipEntry !== undefined && localFiles[i]?.data === undefined) {
      const bytes = await zipEntry.getData(new Uint8ArrayWriter());
      await bulkWriteEntities(username, [{ path: filePaths[i], data: bytes }]);
      fileCount += 1;
    }
    onProgress({ step: 'files', done: i + 1, total: fileIds.length });
  }

  return {
    linkCount: freshLinks.length,
    listCount: entries.filter((entry) => entry.kind === 'list').length,
    tagCount: entries.filter((entry) => entry.kind === 'tag').length,
    fileCount,
    skippedCount,
    invalidCount,
  };
}

// --- interop zips ------------------------------------------------------------------

// The text entries an interop zip can carry (Pocket's shutdown export is a zip
// of part_*.csv files; other services zip an HTML bookmarks file the same way).
const INTEROP_ZIP_ENTRY_RE = /\.(csv|html?|txt)$/i;

// Parse every recognizable text entry and concatenate the rows — the zip-level
// mirror of the text branch in importAllData. Archiver metadata (__MACOSX/…)
// and hidden files are skipped; filename order keeps multi-part exports
// (part_000000.csv, part_000001.csv, …) in sequence.
async function parseInteropZip(byName: Map<string, FileEntry>): Promise<ImportedLink[]> {
  const { TextWriter } = await import('@zip.js/zip.js');

  const candidates = [...byName.entries()]
    .filter(([name]) => {
      const base = name.slice(name.lastIndexOf('/') + 1);
      return (
        INTEROP_ZIP_ENTRY_RE.test(name) && !name.startsWith('__MACOSX/') && !base.startsWith('.')
      );
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (candidates.length === 0) {
    throw new Error(
      'This zip is neither a Brace backup nor a bookmarks export (no .html, .csv, or .txt files inside).',
    );
  }

  const parsed: ImportedLink[] = [];
  for (const [name, entry] of candidates) {
    const text = await entry.getData(new TextWriter());
    const format = detectTextImportFormat(text, name);
    parsed.push(
      ...(format === 'netscape'
        ? parseNetscapeHtml(text)
        : format === 'csv'
          ? parseRaindropCsv(text)
          : parseUrlText(text)),
    );
  }
  return parsed;
}

// The zip dispatch: one reader, one entry map. manifest.json marks a Brace
// backup (restored verbatim); any other zip is treated as a zipped interop
// export and its text entries become new links.
async function importZip(
  username: string,
  file: File,
  maxLinks: number | null,
  nestedLists: boolean,
  onProgress: (progress: ImportProgress) => void,
): Promise<Omit<ImportOutcome, 'syncFailed'>> {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const zipReader = new ZipReader(new BlobReader(file));

  try {
    const zipEntries = await zipReader.getEntries();
    const byName = new Map<string, FileEntry>(
      zipEntries
        .filter((entry): entry is FileEntry => !entry.directory)
        .map((entry) => [entry.filename, entry]),
    );

    if (byName.has('manifest.json')) {
      return await importBraceBackup(username, byName, maxLinks, onProgress);
    }
    const parsed = await parseInteropZip(byName);
    return await importInterop(username, parsed, maxLinks, nestedLists, onProgress);
  } finally {
    await zipReader.close();
  }
}

// --- the flow -----------------------------------------------------------------------

export async function importAllData(options: {
  file: File;
  deps: SyncDeps;
  // The plan's link cap (entitlementsOf(plan).maxLinks); null = unlimited.
  maxLinks: number | null;
  // Whether folder paths may create nested lists (entitlements.nestedLists).
  nestedLists: boolean;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<ImportOutcome> {
  const { file, deps, maxLinks, nestedLists } = options;
  const onProgress = options.onProgress ?? (() => undefined);

  // Refresh first so dedupe, skip-existing, and the quota gate see the account,
  // not just this device. Best-effort: a failed cycle downgrades to a warning
  // and the import checks against the local copy.
  onProgress({ step: 'sync' });
  let syncFailed = false;
  try {
    await runIncrementalSync(deps);
  } catch {
    syncFailed = true;
  }

  onProgress({ step: 'parse' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZipBytes(bytes)) {
    const outcome = await importZip(deps.username, file, maxLinks, nestedLists, onProgress);
    return { ...outcome, syncFailed };
  }

  const text = new TextDecoder().decode(bytes);
  const format = detectTextImportFormat(text, file.name);
  const parsed =
    format === 'netscape'
      ? parseNetscapeHtml(text)
      : format === 'csv'
        ? parseRaindropCsv(text)
        : parseUrlText(text);
  const outcome = await importInterop(deps.username, parsed, maxLinks, nestedLists, onProgress);
  return { ...outcome, syncFailed };
}
