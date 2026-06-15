'use client';

// Reactive read of the user's lists for the sidebar. Live over `items` like
// useLinks, sorted by name for a stable sidebar order.

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { type ListItem, readLists } from '@/data/user-data';

export function useLists(): ListItem[] {
  const lists = useLiveQuery(() => readLists(), []);
  return useMemo(() => (lists ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)), [lists]);
}
