import { buildTree, LIST_NO_CHILDREN_IDS, TRASH_ID, type TreeNode } from '@stxapps/shared';

import { excludeActiveDescendants, getMovePlan, getProjection, INDENT_WIDTH } from './dnd-helpers';
import { flattenTree, type ListRow } from './tree-helpers';

import type { ListItem } from '@/data/queries';

// Minimal ListItem; only id/parentId/rank/name matter to the tree + projection.
function item(id: string, parentId: string | null, rank: string): ListItem {
  return { id, name: id, parentId, rank, createdAt: 0, updatedAt: 0, path: `${id}.json` };
}

// A small forest:  A | B > [B1] | C  (B has one child, all else at root).
function fixture(): { lists: TreeNode<ListItem>[]; rows: ListRow[] } {
  const items = [
    item('A', null, 'a'),
    item('B', null, 'b'),
    item('B1', 'B', 'a'),
    item('C', null, 'c'),
  ];
  const lists = buildTree(items, { noChildrenIds: LIST_NO_CHILDREN_IDS });
  return { lists, rows: flattenTree(lists, new Set()) };
}

const NONE: ReadonlySet<string> = new Set();

describe('excludeActiveDescendants', () => {
  it('drops the active row’s subtree but keeps the row itself', () => {
    const { rows } = fixture();
    expect(excludeActiveDescendants(rows, 'B').map((r) => r.item.id)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when nothing is dragged or the id is gone', () => {
    const { rows } = fixture();
    expect(excludeActiveDescendants(rows, null)).toBe(rows);
    expect(excludeActiveDescendants(rows, 'nope').map((r) => r.item.id)).toEqual([
      'A',
      'B',
      'B1',
      'C',
    ]);
  });
});

describe('getProjection', () => {
  it('keeps a row at root when dragged with no horizontal offset', () => {
    const { rows } = fixture();
    expect(getProjection(rows, 'A', 'C', 0)).toEqual({ depth: 0, parentId: null });
  });

  it('nests under the previous row when dragged one indent right', () => {
    const { rows } = fixture();
    // A dropped just under B, indented one level → child of B.
    expect(getProjection(rows, 'A', 'B', INDENT_WIDTH)).toEqual({ depth: 1, parentId: 'B' });
  });

  it('clamps depth to one past the previous row, however far right', () => {
    const { rows } = fixture();
    const { depth } = getProjection(rows, 'A', 'B', INDENT_WIDTH * 10);
    expect(depth).toBe(1);
  });

  it('never nests under a no-children container (Trash)', () => {
    const items = [item('A', null, 'a'), item(TRASH_ID, null, 'z')];
    const lists = buildTree(items, { noChildrenIds: LIST_NO_CHILDREN_IDS });
    const rows = flattenTree(lists, NONE);
    // Drag A under Trash, pushed hard right: max depth stays at Trash's depth.
    expect(getProjection(rows, 'A', TRASH_ID, INDENT_WIDTH * 5)).toEqual({
      depth: 0,
      parentId: null,
    });
  });
});

describe('getMovePlan', () => {
  it('reparents A as the first child of B', () => {
    const { lists, rows } = fixture();
    const plan = getMovePlan(lists, rows, 'A', 'B', INDENT_WIDTH);
    expect(plan).toMatchObject({ parentId: 'B', index: 0 });
    expect(plan?.item.id).toBe('A');
    expect(plan?.siblings.map((s) => s.id)).toEqual(['B1']); // excludes A
  });

  it('moves A to the end of the root group', () => {
    const { lists, rows } = fixture();
    const plan = getMovePlan(lists, rows, 'A', 'C', 0);
    // Root siblings excluding A are B and C; A lands after both.
    expect(plan).toMatchObject({ parentId: null, index: 2 });
    expect(plan?.siblings.map((s) => s.id)).toEqual(['B', 'C']);
  });
});
