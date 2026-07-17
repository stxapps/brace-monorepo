// Specs for share-store: the taxonomy builders the snapshot/live paths share,
// the defensive parses guarding what crosses the App Group container, and the
// outbox drain's FILE handling — above all that a file the drain can't read is
// quarantined rather than deleted (an outbox draft is sometimes the only copy of
// a share). What the drain writes into sqlite, and the encrypt/upload half, stay
// on-device (docs/share-sheet.md).
//
// The import graph reaches the native stores (db.ts → expo-sqlite, the App Group
// helpers → expo-file-system, session-store → expo-secure-store). The pure
// functions never call them, but the drain does — so expo-file-system gets an
// in-memory stand-in (the shape session-store.spec.ts established) and the
// stores behind applyShareDraft are stubbed to no-ops. This file asserts where
// FILES end up, nothing about the writes.
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
  clearShareData,
  drainShareOutbox,
  parseShareDraft,
  parseShareTaxonomy,
  type ShareDraft,
  type ShareTaxonomy,
} from './share-store';

// The in-memory filesystem behind the expo-file-system stand-in: uri → contents
// for files, a bare uri set for directories. Declared outside the factory
// (mock-prefixed so jest's hoisting allows the reference) so tests seed and
// inspect them directly; only the mock's METHOD BODIES read them, which is what
// keeps the hoisted factory clear of the TDZ.
const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();

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
// A working File/Directory pair over the maps above — enough of the real API for
// the drain: exists / list / textSync / move / delete / create. Paths are joined
// scheme-less ('group/share/outbox/x.json') to keep the join trivial.
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]): string =>
    parts
      .map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');

  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
    textSync(): string {
      const text = mockFiles.get(this.uri);
      // The real File throws on an unreadable path — the drain must survive it.
      if (text === undefined) throw new Error(`MockFile: no such file ${this.uri}`);
      return text;
    }
    write(text: string): void {
      mockFiles.set(this.uri, text);
    }
    create(): void {
      mockFiles.set(this.uri, '');
    }
    delete(): void {
      mockFiles.delete(this.uri);
    }
    move(destination: { uri: string }): void {
      const name = this.name;
      const text = mockFiles.get(this.uri) ?? '';
      mockFiles.delete(this.uri);
      this.uri = `${destination.uri}/${name}`;
      mockFiles.set(this.uri, text);
    }
  }

  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return mockDirs.has(this.uri);
    }
    create(): void {
      mockDirs.add(this.uri);
    }
    delete(): void {
      const prefix = `${this.uri}/`;
      mockDirs.delete(this.uri);
      for (const uri of [...mockDirs]) if (uri.startsWith(prefix)) mockDirs.delete(uri);
      for (const uri of [...mockFiles.keys()]) if (uri.startsWith(prefix)) mockFiles.delete(uri);
    }
    // Direct children only, files and subdirectories alike — the drain relies on
    // telling them apart via `instanceof File`.
    list(): unknown[] {
      const prefix = `${this.uri}/`;
      const isChild = (uri: string) =>
        uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/');
      return [
        ...[...mockFiles.keys()].filter(isChild).map((uri) => new MockFile(uri)),
        ...[...mockDirs].filter(isChild).map((uri) => new MockDirectory(uri)),
      ];
    }
  }

  return {
    Paths: { document: 'file:///documents/', cache: 'file:///cache/', appleSharedContainers: {} },
    File: MockFile,
    Directory: MockDirectory,
  };
});

// The App Group container root — the drain's `group`.
jest.mock('./app-group', () => ({
  appGroupDir: () => {
    const { Directory } = jest.requireMock<typeof import('expo-file-system')>('expo-file-system');
    return new Directory('group');
  },
}));

// A signed-in session, so the drain gets past its guard.
jest.mock('./session-store', () => ({
  getSession: () => ({ username: 'alice', encryptionKey: new Uint8Array(32) }),
  loadSession: jest.fn(async () => undefined),
  loadSharedSession: jest.fn(async () => null),
}));

// applyShareDraft's store edge. The drain's sqlite writes are on-device
// territory; these exist so a VALID draft can reach the end of the loop and have
// its file deleted, which is the half of the quarantine invariant that says
// "still delete what you did apply".
jest.mock('./db', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }) }),
  items: { path: 'path' },
}));
jest.mock('./item-store', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('./mutations', () => ({
  writeLink: jest.fn(async () => undefined),
  writeList: jest.fn(async () => undefined),
  writeTag: jest.fn(async () => undefined),
  writeExtraction: jest.fn(async () => undefined),
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

  it('rejects malformed payloads', () => {
    expect(parseShareDraft('not json')).toBeNull();
    expect(parseShareDraft(JSON.stringify({ ...draft, url: '' }))).toBeNull();
    expect(parseShareDraft(JSON.stringify({ ...draft, tagIds: 'nope' }))).toBeNull();
  });

  it('rejects a payload with a missing newLists or a rank-free new entry', () => {
    // No back-compat slack (see the header): the sheet always writes newLists
    // and always mints a rank, so either absence is corruption rather than an
    // older build — there is no older build.
    const { newLists: _newLists, ...noNewLists } = draft;
    expect(parseShareDraft(JSON.stringify(noNewLists))).toBeNull();
    expect(
      parseShareDraft(JSON.stringify({ ...draft, newTags: [{ id: 'tag-2', name: 'fresh' }] })),
    ).toBeNull();
    expect(
      parseShareDraft(
        JSON.stringify({ ...draft, newLists: [{ id: 'list-new', name: 'Recipes' }] }),
      ),
    ).toBeNull();
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

  it('rejects a rank-free snapshot', () => {
    // refreshShareTaxonomy always writes ranks, so a rank-free row means a
    // corrupt file. Reading it as signed-out is the right answer: it points the
    // user at the app, which rewrites the snapshot.
    const old = {
      sessionPresent: true,
      lists: [{ id: MY_LIST_ID, name: 'My List', depth: 0 }],
      tags: [{ id: 'tag-1', name: 'alpha' }],
    };
    expect(parseShareTaxonomy(JSON.stringify(old))).toBeNull();
  });

  it('rejects malformed payloads', () => {
    expect(parseShareTaxonomy('42')).toBeNull();
    expect(parseShareTaxonomy(JSON.stringify({ sessionPresent: true }))).toBeNull();
  });
});

describe('drainShareOutbox', () => {
  const OUTBOX = 'group/share/outbox';
  const FAILED = 'group/share/failed';

  const draft: ShareDraft = {
    id: 'link-1',
    url: 'https://example.com/a',
    title: 'Example',
    listId: MY_LIST_ID,
    tagIds: ['tag-1'],
    newTags: [{ id: 'tag-1', name: 'fresh', rank: 'a1' }],
    newLists: [],
    sharedAt: 1_700_000_000_000,
  };

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(OUTBOX);
  });

  it('applies a valid draft and deletes its file', async () => {
    mockFiles.set(`${OUTBOX}/link-1.json`, JSON.stringify(draft));

    await expect(drainShareOutbox()).resolves.toBe(1);
    // Applied means gone — and NOT quarantined.
    expect([...mockFiles.keys()]).toEqual([]);
  });

  it('quarantines an unparseable file instead of deleting it', async () => {
    mockFiles.set(`${OUTBOX}/broken.json`, 'not json');

    await expect(drainShareOutbox()).resolves.toBe(0);
    // Out of the drain's path, so it can't be retried forever...
    expect(mockFiles.has(`${OUTBOX}/broken.json`)).toBe(false);
    // ...but not destroyed: an outbox draft can be the only copy of a share.
    expect(mockFiles.get(`${FAILED}/broken.json`)).toBe('not json');
  });

  it('quarantines a draft the schema rejects — the post-ship skew case', async () => {
    // The scenario the tight schema buys: a draft parked by an older build (here,
    // one predating sheet-minted ranks), drained by a newer one. It must survive
    // as a recoverable file rather than vanish.
    const { rank: _rank, ...rankFree } = draft.newTags[0];
    const parked = JSON.stringify({ ...draft, newTags: [rankFree] });
    mockFiles.set(`${OUTBOX}/old-build.json`, parked);

    await expect(drainShareOutbox()).resolves.toBe(0);
    expect(mockFiles.get(`${FAILED}/old-build.json`)).toBe(parked);
  });

  it('keeps draining the rest of the outbox past a bad file', async () => {
    mockFiles.set(`${OUTBOX}/bad.json`, 'not json');
    mockFiles.set(`${OUTBOX}/good.json`, JSON.stringify(draft));

    await expect(drainShareOutbox()).resolves.toBe(1);
    expect(mockFiles.get(`${FAILED}/bad.json`)).toBe('not json');
    expect(mockFiles.has(`${OUTBOX}/good.json`)).toBe(false);
  });

  it('clears the quarantine on sign-out along with everything else', () => {
    // The parked files hold plaintext URLs — they must not outlive the session
    // or leak to the next account.
    mockDirs.add(FAILED);
    mockDirs.add('group/share');
    mockFiles.set(`${FAILED}/broken.json`, 'not json');
    mockFiles.set('group/share/taxonomy.json', '{}');

    clearShareData();

    expect([...mockFiles.keys()]).toEqual([]);
    expect([...mockDirs]).toEqual([]);
  });
});
