// Fractional-index ordering for lists/tags (entities.ts `rank`). The thin
// platform-agnostic wrapper over `fractional-indexing` so every client mints
// order keys by ONE definition — and so the dep is swappable from here alone.
//
// Why a string key and not an integer position: each entity is its own
// encrypted file under last-writer-wins (docs/local-first-sync.md). With integer
// positions, inserting/moving one entity renumbers its siblings → many file
// writes → many LWW points → concurrent reorders clobber. A fractional key lets
// an insert between neighbours A and B compute `between(A.rank, B.rank)` and
// write ONLY the moved entity's file. A.rank and B.rank are untouched, so two
// devices moving two different entities never conflict.
//
// Keys sort by plain ascending string comparison (`<`), which is all buildTree
// (tree.ts) needs. Concurrent inserts at the same slot can mint equal keys — a
// tie, never data loss — broken deterministically by id in the sort.

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// A key ordered strictly between `a` and `b` (ascending). Pass `null` for an
// open end: `between(null, b)` prepends before everything, `between(a, null)`
// appends after everything, `between(null, null)` is the first key in an empty
// group.
export function rankBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

// `n` evenly-spaced keys strictly between `a` and `b` (ascending). Used to seed a
// batch at once — e.g. the system-list defaults — without n round-trips through
// `rankBetween` (which would degenerate to one side).
export function ranksBetween(a: string | null, b: string | null, n: number): string[] {
  return generateNKeysBetween(a, b, n);
}

// The rank that places an entity at `index` within an already-sorted sibling
// group (the array buildTree produced, MINUS the entity being moved). `index` is
// clamped to `[0, siblings.length]`; 0 prepends, `length` appends. This is the
// one helper a reorder/move UI calls: it turns "drop at position i" into the key
// to persist on the moved entity — and nothing else is rewritten.
export function rankForIndex(siblings: { rank: string }[], index: number): string {
  const i = Math.max(0, Math.min(index, siblings.length));
  const before = i > 0 ? siblings[i - 1].rank : null;
  const after = i < siblings.length ? siblings[i].rank : null;
  return rankBetween(before, after);
}
