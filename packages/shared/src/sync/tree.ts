// Turn a flat set of ranked, parented entities (lists or tags — entities.ts) into
// an ordered forest for the UI. Pure and entity-agnostic: it knows only the three
// structural fields, so lists and tags share it (and a tag set that never nests
// just comes back as one flat ranked level).
//
// Every rule here is a READ-TIME reconciliation of what last-writer-wins can
// leave behind — the same spirit as "a dangling reference is NORMAL, the UI skips
// it" elsewhere. Two devices editing different files concurrently can produce a
// `parentId` that points at a deleted entity, forms a cycle, or names a
// forbidden parent; none of that may crash or hide an entity, so each is folded
// back to a root placement. Given identical input the output is identical on
// every device (sibling order is by `rank`, ties broken by `id`; the cycle scan
// walks ids in sorted order), so two devices render the same tree.

import { compareRank } from './rank';

// The structural contract an entity must satisfy to be tree-able. Any `T` with
// these fields works; the node carries the whole `T` so the UI keeps its `path`,
// `name`, timestamps, etc.
export interface TreeItem {
  id: string;
  parentId: string | null;
  rank: string;
}

export interface TreeNode<T extends TreeItem> {
  item: T;
  // 0 at the root, +1 per level — the UI's indentation depth.
  depth: number;
  children: TreeNode<T>[];
}

export interface BuildTreeOptions {
  // Ids that may not be a PARENT (they can still be children). Anything naming
  // one of these as its `parentId` is promoted to root. For lists this is
  // `{TRASH_ID}` — Trash is a leaf container, nothing nests inside it.
  noChildrenIds?: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function buildTree<T extends TreeItem>(
  items: T[],
  options?: BuildTreeOptions,
): TreeNode<T>[] {
  const noChildren = options?.noChildrenIds ?? EMPTY_SET;
  const byId = new Map(items.map((i) => [i.id, i]));

  // Resolve each entity's EFFECTIVE parent: null (root) when the declared parent
  // is null, missing (orphan), or a forbidden (no-children) id.
  const parentOf = new Map<string, string | null>();
  for (const item of items) {
    const p = item.parentId;
    parentOf.set(item.id, p !== null && byId.has(p) && !noChildren.has(p) ? p : null);
  }

  // Break cycles: an entity that can't reach a root by following effective
  // parents is part of a loop, so detach it (root). Walked over ids in sorted
  // order so the broken edge is the same on every device. Each detach can only
  // free other members, never create a new cycle, so one pass suffices.
  for (const id of [...byId.keys()].sort()) {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur !== null) {
      if (seen.has(cur)) {
        parentOf.set(id, null);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  // Group by effective parent, then assemble top-down, sorting each sibling group.
  const childrenOf = new Map<string | null, T[]>();
  for (const item of items) {
    const p = parentOf.get(item.id) ?? null;
    const group = childrenOf.get(p);
    if (group) group.push(item);
    else childrenOf.set(p, [item]);
  }

  const build = (parentId: string | null, depth: number): TreeNode<T>[] =>
    (childrenOf.get(parentId) ?? [])
      .slice()
      .sort(compareRank)
      .map((item) => ({ item, depth, children: build(item.id, depth + 1) }));

  return build(null, 0);
}

// Flatten a forest back to a depth-first list — the order the UI renders rows in,
// each row already carrying its `depth`. Saves every consumer rewriting the same
// recursion just to map over nodes.
export function flattenTree<T extends TreeItem>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (ns: TreeNode<T>[]): void => {
    for (const n of ns) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
