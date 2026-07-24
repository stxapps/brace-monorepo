// Tree → rows helpers for the Lists settings section — the expo half of the pair
// brace-web's `_lists/tree-helpers.ts` is. The forest-shape logic is generic and
// identical on both platforms, so it lives in `@stxapps/shared` (`sync/tree.ts`,
// next to buildTree/flattenTree); this module just specializes it to `ListItem`
// and names the row `ListRow` for the table's call sites. (Web's dnd-helpers
// sibling is NOT ported — reorder here is buttons-only; a drag surface can bring
// it later.)
//
// - `flattenToRows` — forest → flat, depth-tagged rows (skipping collapsed
//   subtrees), each carrying its sibling group + index so the reorder controls
//   need no second walk.
// - `childrenOf` — the ordered child items of a parent (a "move to" destination).
// - `forbiddenParentIds` — ids a list may not move under (itself, its subtree,
//   Trash).

import type { ListItem, TreeRow } from '@stxapps/shared';

export { childrenOf, flattenToRows, forbiddenParentIds } from '@stxapps/shared';

export type ListRow = TreeRow<ListItem>;
