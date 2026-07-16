// Specs for share-store's pure half: the taxonomy builders the snapshot/live
// paths share, and the defensive parses guarding what crosses the App Group
// container. The db/file plumbing is exercised on-device (docs/share-sheet.md
// — none of the native share surface is jest-reachable).

// The import graph reaches the native stores (db.ts → expo-sqlite, the App
// Group helpers → expo-file-system, session-store → expo-secure-store); the
// pure functions under test never call them, so inert stand-ins suffice.
import {
  ARCHIVE_ID,
  type List,
  MY_LIST_ID,
  rankBetween,
  SYSTEM_LIST_DEFAULTS,
  type Tag,
  TRASH_ID,
} from '@stxapps/shared';

import {
  buildShareLists,
  buildShareTags,
  parseShareDraft,
  parseShareTaxonomy,
  type ShareDraft,
  type ShareTaxonomy,
} from './share-store';

jest.mock('expo-sqlite', () => ({ openDatabaseSync: jest.fn() }));
// share-store's post-Add kicks reach the sync engine and the upload,
// whose import graphs end in native modules (react-native-quick-crypto via
// @stxapps/expo-crypto, expo-file-system/legacy via sync/r2) — inert them too.
jest.mock('@stxapps/expo-crypto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 'binaryContent' },
  uploadAsync: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents/', cache: 'file:///cache/', appleSharedContainers: {} },
  File: class MockFile {},
  Directory: class MockDirectory {},
}));

const trashDefault = SYSTEM_LIST_DEFAULTS.find((def) => def.id === TRASH_ID);
if (!trashDefault) throw new Error('SYSTEM_LIST_DEFAULTS is missing Trash');
const trashRank = trashDefault.rank;
const archiveDefault = SYSTEM_LIST_DEFAULTS.find((def) => def.id === ARCHIVE_ID);
if (!archiveDefault) throw new Error('SYSTEM_LIST_DEFAULTS is missing Archive');

function makeList(id: string, name: string, parentId: string | null, rank: string): List {
  return { id, name, parentId, rank, createdAt: 1, updatedAt: 1 };
}

function makeTag(id: string, name: string, rank: string): Tag {
  return { id, name, parentId: null, rank, createdAt: 1, updatedAt: 1 };
}

describe('buildShareLists', () => {
  it('overlays system defaults, orders the tree, and annotates depth + rank', () => {
    const rankA = rankBetween(trashRank, null);
    const rankB = rankBetween(null, null);
    const stored = [
      // A renamed My List — the override must win over the default name.
      makeList(MY_LIST_ID, 'Inbox', null, SYSTEM_LIST_DEFAULTS[0].rank),
      makeList('list-a', 'Reading', null, rankA),
      makeList('list-b', 'Papers', 'list-a', rankB),
    ];

    const rows = buildShareLists(stored);

    // Ranks ride along so the sheet can mint neighbour ranks for its creates.
    expect(rows).toEqual([
      { id: MY_LIST_ID, name: 'Inbox', depth: 0, rank: SYSTEM_LIST_DEFAULTS[0].rank },
      { id: ARCHIVE_ID, name: 'Archive', depth: 0, rank: archiveDefault.rank },
      { id: 'list-a', name: 'Reading', depth: 0, rank: rankA },
      { id: 'list-b', name: 'Papers', depth: 1, rank: rankB },
    ]);
    // Trash never shows — saving into the deletion staging area is incoherent.
    // And ONLY Trash: hidden/locked lists stay pickable, like every editor
    // picker (docs/editors.md) — there is deliberately no lock filter here.
    expect(rows.some((row) => row.id === TRASH_ID)).toBe(false);
  });
});

describe('buildShareTags', () => {
  it('orders by rank regardless of input order', () => {
    const rA = rankBetween(null, null);
    const rB = rankBetween(rA, null);
    const rC = rankBetween(rB, null);
    const tags = [makeTag('c', 'gamma', rC), makeTag('a', 'alpha', rA), makeTag('b', 'beta', rB)];

    expect(buildShareTags(tags)).toEqual([
      { id: 'a', name: 'alpha', rank: rA },
      { id: 'b', name: 'beta', rank: rB },
      { id: 'c', name: 'gamma', rank: rC },
    ]);
  });
});

describe('parseShareDraft', () => {
  const draft: ShareDraft = {
    id: 'link-1',
    url: 'https://example.com/a',
    title: 'Example',
    listId: MY_LIST_ID,
    tagIds: ['tag-1', 'tag-2'],
    newTags: [{ id: 'tag-2', name: 'fresh', rank: 'a1' }],
    newLists: [{ id: 'list-new', name: 'Recipes', rank: 'Zz' }],
    sharedAt: 1_700_000_000_000,
  };

  it('round-trips a valid draft', () => {
    expect(parseShareDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('accepts a draft from a build predating newLists and sheet-minted ranks', () => {
    // The drain DELETES a draft that fails to parse, so an old outbox file must
    // parse — newLists defaults to [], ranks stay absent (computed at apply).
    const { newLists: _newLists, ...oldDraft } = draft;
    const parsed = parseShareDraft(
      JSON.stringify({ ...oldDraft, newTags: [{ id: 'tag-2', name: 'fresh' }] }),
    );
    expect(parsed).toEqual({
      ...oldDraft,
      newTags: [{ id: 'tag-2', name: 'fresh' }],
      newLists: [],
    });
  });

  it('rejects malformed payloads', () => {
    expect(parseShareDraft('not json')).toBeNull();
    expect(parseShareDraft(JSON.stringify({ ...draft, url: '' }))).toBeNull();
    expect(parseShareDraft(JSON.stringify({ ...draft, tagIds: 'nope' }))).toBeNull();
  });
});

describe('parseShareTaxonomy', () => {
  const taxonomy: ShareTaxonomy = {
    sessionPresent: true,
    lists: [{ id: MY_LIST_ID, name: 'My List', depth: 0, rank: 'a0' }],
    tags: [{ id: 'tag-1', name: 'alpha', rank: 'a1' }],
  };

  it('round-trips a valid snapshot', () => {
    expect(parseShareTaxonomy(JSON.stringify(taxonomy))).toEqual(taxonomy);
  });

  it('accepts a rank-free snapshot from a pre-rank build', () => {
    // Must not read as signed-out — the sheet just can't mint ranks from it.
    const old = {
      sessionPresent: true,
      lists: [{ id: MY_LIST_ID, name: 'My List', depth: 0 }],
      tags: [{ id: 'tag-1', name: 'alpha' }],
    };
    expect(parseShareTaxonomy(JSON.stringify(old))).toEqual(old);
  });

  it('rejects malformed payloads', () => {
    expect(parseShareTaxonomy('42')).toBeNull();
    expect(parseShareTaxonomy(JSON.stringify({ sessionPresent: true }))).toBeNull();
  });
});
