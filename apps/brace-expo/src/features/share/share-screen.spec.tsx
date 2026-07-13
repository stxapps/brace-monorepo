import * as React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { loadShareTaxonomy, saveSharedDraft, type ShareDraft } from '@stxapps/expo-react';
import { DEFAULT_LIST_ID, MY_LIST_ID } from '@stxapps/shared';

import { ShareScreen } from './share-screen';

// The store seam is mocked whole — the sheet's data exchange is share-store's
// concern (spec'd there); these specs cover the screen's behavior over it.
jest.mock('@stxapps/expo-react', () => ({
  loadShareTaxonomy: jest.fn(),
  saveSharedDraft: jest.fn(),
}));
let mockIdCounter = 0;
jest.mock('@stxapps/expo-crypto', () => ({ newId: jest.fn(() => `minted-${++mockIdCounter}`) }));
jest.mock('./share-host', () => ({ closeShareSheet: jest.fn() }));

const loadShareTaxonomyMock = loadShareTaxonomy as jest.Mock;
const saveSharedDraftMock = saveSharedDraft as jest.Mock;

const TAXONOMY = {
  sessionPresent: true,
  lists: [
    { id: MY_LIST_ID, name: 'My List', depth: 0 },
    { id: 'list-a', name: 'Reading', depth: 0 },
  ],
  tags: [{ id: 'tag-a', name: 'alpha' }],
};

beforeEach(() => {
  mockIdCounter = 0;
  loadShareTaxonomyMock.mockReset().mockResolvedValue(TAXONOMY);
  saveSharedDraftMock.mockReset().mockResolvedValue('saved');
});

test('shows the signed-out notice when no session is present', async () => {
  loadShareTaxonomyMock.mockResolvedValue({ sessionPresent: false, lists: [], tags: [] });
  const { findByTestId } = render(<ShareScreen url="https://example.com" />);
  expect(await findByTestId('share-signed-out')).toBeTruthy();
});

test('shows the no-url notice when nothing shareable arrived', async () => {
  const { findByTestId } = render(<ShareScreen url={null} />);
  expect(await findByTestId('share-no-url')).toBeTruthy();
});

test('saves a draft into the picked list and shows the saved state', async () => {
  const { findByTestId, getByTestId } = render(
    <ShareScreen url="https://example.com/a" title="Example" />,
  );

  fireEvent.press(await findByTestId('share-list-list-a'));
  fireEvent.press(getByTestId('share-tag-tag-a'));
  fireEvent.press(getByTestId('share-add'));

  await waitFor(() => expect(saveSharedDraftMock).toHaveBeenCalledTimes(1));
  const draft = saveSharedDraftMock.mock.calls[0][0] as ShareDraft;
  expect(draft).toMatchObject({
    url: 'https://example.com/a',
    title: 'Example',
    listId: 'list-a',
    tagIds: ['tag-a'],
    newTags: [],
  });
  expect(draft.id).toMatch(/^minted-/);
  expect(await findByTestId('share-saved')).toBeTruthy();
});

test('defaults to the inbox list and reuses an existing tag by name', async () => {
  const { findByTestId, getByTestId } = render(<ShareScreen url="https://example.com/b" />);

  const input = await findByTestId('share-tag-input');
  // Case-insensitive reuse — must select tag-a, not mint a duplicate.
  fireEvent.changeText(input, 'ALPHA');
  fireEvent(input, 'submitEditing');
  // A genuinely new name mints a new tag.
  fireEvent.changeText(input, 'fresh');
  fireEvent(input, 'submitEditing');
  fireEvent.press(getByTestId('share-add'));

  await waitFor(() => expect(saveSharedDraftMock).toHaveBeenCalledTimes(1));
  const draft = saveSharedDraftMock.mock.calls[0][0] as ShareDraft;
  expect(draft.listId).toBe(DEFAULT_LIST_ID);
  expect(draft.newTags).toEqual([{ id: 'minted-1', name: 'fresh' }]);
  expect(draft.tagIds).toEqual(['tag-a', 'minted-1']);
});
