import { buildTree, flattenTree, type TreeItem } from './tree';

// Minimal tree item; `name` rides along to prove the whole entity is carried.
interface Node extends TreeItem {
  name: string;
}
const n = (id: string, parentId: string | null, rank: string, name = id): Node => ({
  id,
  parentId,
  rank,
  name,
});

// The flattened (id, depth) shape — the order/nesting the UI renders.
const shape = (nodes: ReturnType<typeof buildTree<Node>>) =>
  flattenTree(nodes).map((node) => ({ id: node.item.id, depth: node.depth }));

describe('buildTree', () => {
  it('orders roots by rank, then by id on a tie', () => {
    const out = buildTree([
      n('c', null, 'b'),
      n('a', null, 'a'),
      n('b', null, 'a'), // ties with `a` on rank → id breaks it
    ]);
    expect(out.map((node) => node.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('nests children under their parent and assigns depth', () => {
    const out = buildTree([
      n('root', null, 'a'),
      n('child', 'root', 'a'),
      n('grandchild', 'child', 'a'),
    ]);
    expect(shape(out)).toEqual([
      { id: 'root', depth: 0 },
      { id: 'child', depth: 1 },
      { id: 'grandchild', depth: 2 },
    ]);
  });

  it('promotes an orphan (missing parent) to the root', () => {
    const out = buildTree([n('a', 'ghost', 'a')]);
    expect(shape(out)).toEqual([{ id: 'a', depth: 0 }]);
  });

  it('promotes a child of a no-children id (e.g. Trash) to the root', () => {
    const out = buildTree([n('trash', null, 'b'), n('a', 'trash', 'a')], {
      noChildrenIds: new Set(['trash']),
    });
    expect(shape(out)).toEqual([
      { id: 'a', depth: 0 },
      { id: 'trash', depth: 0 },
    ]);
  });

  it('breaks a cycle by detaching its members to the root', () => {
    // a → b → a, with c hanging off b.
    const out = buildTree([n('a', 'b', 'a'), n('b', 'a', 'a'), n('c', 'b', 'a')]);
    // No crash, every node present, none lost. `c` stays under `b`; the cycle
    // members surface at the root.
    const flat = shape(out);
    expect(flat.map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    const byId = Object.fromEntries(flat.map((x) => [x.id, x.depth]));
    expect(byId.c).toBe(byId.b + 1);
  });

  it('is deterministic regardless of input order', () => {
    const items = [n('a', null, 'a'), n('b', 'a', 'a'), n('c', 'a', 'b')];
    const forward = shape(buildTree(items));
    const reversed = shape(buildTree([...items].reverse()));
    expect(forward).toEqual(reversed);
  });
});
