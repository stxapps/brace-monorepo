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

function makeList(id: string, name: string, parentId: string | null, rank: string): List {
  return { id, name, parentId, rank, createdAt: 1, updatedAt: 1 };
}

function makeTag(id: string, name: string, rank: string): Tag {
  return { id, name, parentId: null, rank, createdAt: 1, updatedAt: 1 };
}

describe('buildShareLists', () => {
  it('overlays system defaults, orders the tree, and annotates depth', () => {
    const rankA = rankBetween(trashRank, null);
    const stored = [
      // A renamed My List — the override must win over the default name.
      makeList(MY_LIST_ID, 'Inbox', null, SYSTEM_LIST_DEFAULTS[0].rank),
      makeList('list-a', 'Reading', null, rankA),
      makeList('list-b', 'Papers', 'list-a', rankBetween(null, null)),
    ];

    const rows = buildShareLists(stored, new Set());

    expect(rows).toEqual([
      { id: MY_LIST_ID, name: 'Inbox', depth: 0 },
      { id: ARCHIVE_ID, name: 'Archive', depth: 0 },
      { id: 'list-a', name: 'Reading', depth: 0 },
      { id: 'list-b', name: 'Papers', depth: 1 },
    ]);
    // Trash never shows — saving into the deletion staging area is incoherent.
    expect(rows.some((row) => row.id === TRASH_ID)).toBe(false);
  });

  it('drops a hidden list AND its subtree', () => {
    const rankHidden = rankBetween(trashRank, null);
    const stored = [
      makeList('hidden', 'Secret', null, rankHidden),
      makeList('child', 'Inside', 'hidden', rankBetween(null, null)),
    ];

    const rows = buildShareLists(stored, new Set(['hidden']));

    expect(rows.map((row) => row.id)).toEqual([MY_LIST_ID, ARCHIVE_ID]);
  });
});

describe('buildShareTags', () => {
  it('orders by rank regardless of input order', () => {
    const rA = rankBetween(null, null);
    const rB = rankBetween(rA, null);
    const rC = rankBetween(rB, null);
    const tags = [makeTag('c', 'gamma', rC), makeTag('a', 'alpha', rA), makeTag('b', 'beta', rB)];

    expect(buildShareTags(tags)).toEqual([
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
      { id: 'c', name: 'gamma' },
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
    newTags: [{ id: 'tag-2', name: 'fresh' }],
    sharedAt: 1_700_000_000_000,
  };

  it('round-trips a valid draft', () => {
    expect(parseShareDraft(JSON.stringify(draft))).toEqual(draft);
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
    lists: [{ id: MY_LIST_ID, name: 'My List', depth: 0 }],
    tags: [{ id: 'tag-1', name: 'alpha' }],
  };

  it('round-trips a valid snapshot', () => {
    expect(parseShareTaxonomy(JSON.stringify(taxonomy))).toEqual(taxonomy);
  });

  it('rejects malformed payloads', () => {
    expect(parseShareTaxonomy('42')).toBeNull();
    expect(parseShareTaxonomy(JSON.stringify({ sessionPresent: true }))).toBeNull();
  });
});
