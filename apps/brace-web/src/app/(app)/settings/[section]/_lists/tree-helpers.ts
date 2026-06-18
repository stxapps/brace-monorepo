// Pure tree → rows helpers for the Lists settings page. The hook gives us the
// same ordered forest the sidebar renders (TreeNode<ListItem>[], nested by
// `parentId`, ordered by `rank`); this turns it into the flat, depth-tagged row
// list the table renders and answers the positional questions the reorder/move
// actions ask ("who are my siblings?", "where can I move?"). No React, no I/O —
// just shape, so it's trivially testable.

import { LIST_NO_CHILDREN_IDS, type TreeNode } from '@stxapps/shared';

import type { ListItem } from '@/data/queries';

// One rendered row: the list plus everything the row's controls need without a
// second tree walk. `siblings` is the row's ordered sibling group INCLUDING
// itself (so `index`/`siblings.length` answer "am I first/last?"); `parentId` is
// the row's EFFECTIVE parent in the rendered tree (null at the root), which can
// differ from `item.parentId` when buildTree promoted a dangling/forbidden parent
// to the root — reorder must target where the row actually sits.
export interface ListRow {
  item: ListItem;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  siblings: ListItem[];
  index: number;
}

// Flatten the forest depth-first (parent before children), skipping the subtree
// under any id in `collapsedIds`. Order matches the sidebar exactly. Named to
// distinguish it from `shared`'s `flattenTree` (forest → flat `TreeNode[]`): this
// is the richer forest → `ListRow[]` variant the settings table renders.
export function flattenToRows(
  nodes: TreeNode<ListItem>[],
  collapsedIds: ReadonlySet<string>,
): ListRow[] {
  const rows: ListRow[] = [];
  const walk = (group: TreeNode<ListItem>[], parentId: string | null) => {
    const siblings = group.map((node) => node.item);
    group.forEach((node, index) => {
      const hasChildren = node.children.length > 0;
      rows.push({ item: node.item, depth: node.depth, parentId, hasChildren, siblings, index });
      if (hasChildren && !collapsedIds.has(node.item.id)) walk(node.children, node.item.id);
    });
  };
  walk(nodes, null);
  return rows;
}

// The ordered child items of `parentId` (root group when null) — the destination
// sibling group a "move to" needs. Found by a depth-first search for the node,
// since the forest is small.
export function childrenOf(nodes: TreeNode<ListItem>[], parentId: string | null): ListItem[] {
  if (parentId === null) return nodes.map((node) => node.item);
  const found = findNode(nodes, parentId);
  return found ? found.children.map((node) => node.item) : [];
}

// Every id that may NOT receive `listId` as a child: the list itself, its whole
// subtree (no cycles), and any no-children container (Trash). The "move to" menu
// subtracts these from the candidate parents.
export function forbiddenParentIds(nodes: TreeNode<ListItem>[], listId: string): Set<string> {
  const forbidden = new Set<string>(LIST_NO_CHILDREN_IDS);
  const node = findNode(nodes, listId);
  if (node) collectSubtreeIds(node, forbidden);
  return forbidden;
}

function findNode(nodes: TreeNode<ListItem>[], id: string): TreeNode<ListItem> | undefined {
  for (const node of nodes) {
    if (node.item.id === id) return node;
    const inChild = findNode(node.children, id);
    if (inChild) return inChild;
  }
  return undefined;
}

function collectSubtreeIds(node: TreeNode<ListItem>, into: Set<string>): void {
  into.add(node.item.id);
  for (const child of node.children) collectSubtreeIds(child, into);
}
