// Specs for the extension upload: the pure entity builder, and the
// sign → PUT → commit pipeline over a fake api. Crypto and transport are
// stubbed (identity / recorder) — the real frame and R2 path are the engine's,
// asserted elsewhere; here the contract under test is WHAT is uploaded and in
// what order.

import {
  type ApiClient,
  EXTRACTIONS_PREFIX,
  filesSignEndpoint,
  LINKS_PREFIX,
  MY_LIST_ID,
  opsCommitEndpoint,
  pathFromId,
} from '@stxapps/shared';

import type { ShareDraft } from './share-store';
import { buildDraftEntities, uploadShareDraft } from './share-upload';

// encryptEntity → identity, so putBlob receives the plaintext JSON and the
// tests can decode what would have been encrypted.
jest.mock('@stxapps/expo-crypto', () => ({
  encryptEntity: jest.fn(async (_key: Uint8Array, data: Uint8Array) => data),
}));

const mockPutBlob = jest.fn(async () => undefined);
jest.mock('../sync/r2', () => ({
  putBlob: (...args: unknown[]) => mockPutBlob(...(args as [])),
}));

const NOW = 1_700_000_000_000;

const draft: ShareDraft = {
  id: 'link-1',
  url: 'https://example.com/a',
  title: 'Example',
  listId: MY_LIST_ID,
  tagIds: ['tag-a', 'tag-new'],
  newTags: [{ id: 'tag-new', name: 'fresh' }],
  sharedAt: NOW - 5_000,
};

const LINK_PATH = pathFromId('link-1', LINKS_PREFIX);
const EXTRACTION_PATH = pathFromId('link-1', EXTRACTIONS_PREFIX);

beforeEach(() => {
  mockPutBlob.mockClear();
});

describe('buildDraftEntities', () => {
  it('builds the link plus the provisional extraction title — and NO tag entities', () => {
    const entities = buildDraftEntities(draft, NOW);

    expect(entities.map((e) => e.path)).toEqual([LINK_PATH, EXTRACTION_PATH]);
    expect(entities[0].entity).toEqual({
      url: draft.url,
      listId: draft.listId,
      tagIds: draft.tagIds, // new-tag ids stay referenced; the drain creates the tags
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(entities[1].entity).toEqual({
      id: draft.id,
      title: 'Example',
      facets: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('omits the extraction when the payload carried no usable title', () => {
    const entities = buildDraftEntities({ ...draft, title: undefined }, NOW);
    expect(entities.map((e) => e.path)).toEqual([LINK_PATH]);
  });
});

describe('uploadShareDraft', () => {
  const deps = () => {
    const commits: unknown[] = [];
    const api = {
      call: jest.fn(async (endpoint: unknown, req: unknown) => {
        if (endpoint === filesSignEndpoint) {
          const { paths } = req as { paths: string[] };
          return { urls: paths.map((path) => ({ path, url: `https://r2.test/${path}` })) };
        }
        if (endpoint === opsCommitEndpoint) {
          commits.push(req);
          const { ops } = req as { ops: { path: string }[] };
          return { results: ops.map((op) => ({ path: op.path, updatedAt: NOW })) };
        }
        throw new Error('unexpected endpoint');
      }),
    } as unknown as ApiClient;
    return { api, commits, encryptionKey: new Uint8Array(32) };
  };

  it('signs, PUTs each blob to its URL, then commits both puts', async () => {
    const { api, commits, encryptionKey } = deps();
    await uploadShareDraft({ api, encryptionKey }, draft);

    expect(mockPutBlob).toHaveBeenCalledTimes(2);
    const putUrls = mockPutBlob.mock.calls.map((call) => (call as unknown[])[0]);
    expect(putUrls).toEqual([`https://r2.test/${LINK_PATH}`, `https://r2.test/${EXTRACTION_PATH}`]);
    // encryptEntity is identity here — the uploaded bytes decode to the link.
    const linkBytes = (mockPutBlob.mock.calls[0] as unknown[])[1] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(linkBytes))).toMatchObject({
      url: draft.url,
      listId: draft.listId,
      tagIds: draft.tagIds,
    });
    expect(commits).toEqual([
      {
        ops: [
          { op: 'put', path: LINK_PATH },
          { op: 'put', path: EXTRACTION_PATH },
        ],
      },
    ]);
  });

  it('rejects without committing when a signed URL is withheld (e.g. quota)', async () => {
    const { api, encryptionKey } = deps();
    (api.call as jest.Mock).mockImplementation(async (endpoint: unknown) => {
      if (endpoint === filesSignEndpoint) return { urls: [] };
      throw new Error('commit must not be reached');
    });

    await expect(uploadShareDraft({ api, encryptionKey }, draft)).rejects.toThrow(/no signed URL/);
    expect(mockPutBlob).not.toHaveBeenCalled();
  });
});
