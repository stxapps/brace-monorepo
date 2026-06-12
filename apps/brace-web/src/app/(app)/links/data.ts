'use client';

// Read helpers that turn the sync engine's payload-agnostic `items` store (see
// data/db.ts — one decrypted blob per path) into typed entities for the UI.
//
// The sync path stays type-blind on purpose; parsing lives HERE, at the read
// edge. Every namespace is one prefix on the `items` primary key
// (`meta/{id}.enc`, `lists/{id}.enc`, `tags/{id}.enc`), so a namespace query is a
// key-range scan and a typed read is `decode(record, schema)`.

import type { z } from 'zod';

import type { Link, List, Tag } from '@stxapps/shared';
import { linkSchema, LISTS_PREFIX, listSchema, META_PREFIX, TAGS_PREFIX, tagSchema } from '@stxapps/shared';

import { db, type ItemRecord } from '@/data/db';

const decoder = new TextDecoder();

// A parsed entity always carries its source `items` path — the stable id every
// other layer (op log, pending queue, R2) keys by, and what the UI needs to
// select/edit/delete a row without a second lookup.
export type WithPath<T> = T & { path: string };
export type LinkItem = WithPath<Link>;
export type ListItem = WithPath<List>;
export type TagItem = WithPath<Tag>;

// Decode one `items` record into a typed entity, or `undefined` if it can't be
// parsed. Two reasons a record is skipped rather than thrown on:
//   - `data` absent — a `files/` content record seen but not yet lazily
//     downloaded (db.ts). Not expected under these prefixes, but cheap to guard.
//   - schema mismatch — a forward-incompatible shape from a newer client. The
//     read layer drops it from this view instead of crashing the whole list.
// `safeParse` keeps unknown fields (the schemas are `looseObject`), so a decoded
// entity still round-trips cleanly if later re-encrypted.
function decode<T extends z.ZodTypeAny>(
  record: ItemRecord,
  schema: T,
): WithPath<z.infer<T>> | undefined {
  if (!record.data) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(decoder.decode(record.data)));
    if (!parsed.success) return undefined;
    // The entity schemas are all `looseObject`, so `parsed.data` is an object;
    // TS only sees the open `z.infer<T>`, hence the spread widening.
    return { ...(parsed.data as object), path: record.id } as WithPath<z.infer<T>>;
  } catch {
    return undefined;
  }
}

// All records under one namespace prefix, decoded and parse-filtered. The
// `startsWith` runs against the `items` primary key, so it's an index range scan,
// not a full-table walk.
async function readNamespace<T extends z.ZodTypeAny>(
  prefix: string,
  schema: T,
): Promise<WithPath<z.infer<T>>[]> {
  const records = await db.items.where('id').startsWith(prefix).toArray();
  return records
    .map((record) => decode(record, schema))
    .filter((entity): entity is WithPath<z.infer<T>> => entity !== undefined);
}

export function readLinks(): Promise<LinkItem[]> {
  return readNamespace(META_PREFIX, linkSchema);
}

export function readLists(): Promise<ListItem[]> {
  return readNamespace(LISTS_PREFIX, listSchema);
}

export function readTags(): Promise<TagItem[]> {
  return readNamespace(TAGS_PREFIX, tagSchema);
}
