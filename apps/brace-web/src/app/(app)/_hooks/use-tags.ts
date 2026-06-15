'use client';

// Reactive read of the user's tags for the sidebar. Mirrors useLists.

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { readTags, type TagItem } from '@/data/user-data';

export function useTags(): TagItem[] {
  const tags = useLiveQuery(() => readTags(), []);
  return useMemo(() => (tags ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)), [tags]);
}
