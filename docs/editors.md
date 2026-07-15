## editors & the list/tag taxonomy UI

How brace **edits a link** (create + full edit, across three surfaces on two
apps) and how the **list/tag taxonomy** those editors write into is displayed and
picked elsewhere. This is a cross-cutting reference: the editors share a small set
of pickers and a set of invariants, and the same pieces (or the same underlying
data) surface in places that aren't editors at all — the sidebar tree, the row
menu's "Move to". Change an editor without this map and you can silently break one
of those.

See [link-extraction.md](./link-extraction.md) for the _data_ side of what these
editors write — the override-wins model (`customTitle`/`customImageId` sitting
over the extracted fallbacks), the writer-split that keeps a background capture out
of `links/{id}.enc`, and where `resizeImage` fits as the client thumbnailing step;
[client-queries.md](./client-queries.md) for the `useLists`/`useTags`/`useLinks`
read edges every surface here renders over; and
[architecture.md](./architecture.md) for the `web-ui` → `web-react` layering (why
the shared pickers live in `web-ui` yet reach `web-react`'s data hooks, never the
reverse).

### the editing surfaces

Four surfaces edit a link's user-authored fields. They split into **create** (a
URL + list/tags/note, title/image back-filled later by extraction) and **full
edit** (every `links/{id}.enc` field, including the `customTitle`/`customImageId`
overrides). Create collects a strict subset of edit's fields.

| surface               | file                                                        | kind      | fields                                         |
| --------------------- | ----------------------------------------------------------- | --------- | ---------------------------------------------- |
| extension save editor | `apps/brace-extension/entrypoints/popup/Editor.tsx`         | create    | list, tags, note (URL is the tab's, read-only) |
| web quick-add popover | `apps/brace-web/.../links/_components/link-add-popover.tsx` | create    | URL, then list/tags/note behind "Advanced"     |
| web edit dialog       | `apps/brace-web/.../links/_components/link-edit-dialog.tsx` | full edit | title, image, list, tags, note                 |

Two more surfaces edit the taxonomy itself (not links), as inline row editors —
not modal forms, so the invariants below apply loosely (they hold no snapshot
draft; each keystroke commits or reverts in place):

- `apps/brace-web/.../settings/[section]/_lists/lists-section.tsx` — create /
  rename / reorder / **reparent** / delete lists. Nesting _is_ the UI here: drag
  with live depth projection, a "Move to" submenu, and collapse toggles.
- `apps/brace-web/.../settings/[section]/_tags/tags-section.tsx` — the tag
  counterpart **minus nesting**: create / rename / **reorder** (drag or up/down) /
  delete, over one flat ranked group.

  **Lists nest, tags are deliberately flat — and that's a UI decision, not a
  schema one.** Tags carry the _same_ `parentId`/`rank` fields as lists
  (`entities.ts` — both are the same ranked-tree entity), so the store could nest
  them. The tags section chooses not to: a link belongs to exactly **one** list
  (a location → a hierarchy earns its keep) but has **many** tags (flat labels →
  a second hierarchy would only blur "where it lives" vs. "what it's about" and
  duplicate the list tree). So `tags-section` drops everything nesting brings —
  depth projection, the "Move to" reparent submenu, collapse toggles, and the
  system-entity guard (every tag is deletable; there are no system tags) — and
  reorders with a plain `arrayMove` over `useTags`'s top level, which _is_ the
  whole set precisely because nothing nests tags (`buildTree` also re-roots any
  dangling parent). The asymmetry lives only in these two sections + the pickers;
  if tag nesting is ever wanted, the schema, `buildTree`, and `useTagMutations`
  (`move` already takes a `parentId`) already support it — only this section and
  `tags-command` would change.

All link writes go through **one op** — `useLinkMutations` (`create` / `update` /
`saveCustomImage`) — and taxonomy writes through `useListMutations` /
`useTagMutations`. The editors never touch the sync layer; they fire intents and
the one-file-per-entity LWW model does the rest.

### the shared pickers (and their non-obvious consumers)

The list and tag inputs are **two picker pairs** in
`packages/web-ui/src/components/links/`. Each pair is a form-control shell over a
searchable command body; the body owns the tree/search rendering and is wired
straight to `web-react`'s live data hook:

| pair | shell                                            | body                               | data hook                     |
| ---- | ------------------------------------------------ | ---------------------------------- | ----------------------------- |
| list | `list-select.tsx` (`ListSelect`, a combobox)     | `list-command.tsx` (`ListCommand`) | `useLists`                    |
| tag  | `tags-field.tsx` (`TagsField`, a token combobox) | `tags-command.tsx` (`TagsCommand`) | `useTags` / `useTagMutations` |

All three link editors render `ListSelect` + `TagsField`, so the pickers stay
identical across web quick-add, the extension, and the edit dialog. That's the
point of the pairing — one picker over one live tree, no drift.

**Locked and hidden lists stay pickable — the pickers filter only `TRASH_ID`.**
They deliberately do **not** prune the lock model's `hiddenListIds`. Hiding a
list is a pure **sidebar** declutter (`_panes/sidebar.tsx`, `pruneHidden` over
`useLocks().hiddenListIds`); it never blocks filing a link into a list you know
exists. Two reasons the pickers must ignore it: (1) locks are **device-local**
(the `LockRecord` model, see `lock-provider.tsx`), so the extension editor can't
know a web device's hidden lists — pruning them web-side would just make the two
apps' pickers disagree; (2) hide was never a content guarantee anyway. That's
what a **lock** is: `lockedListIds` folds into the link query's `lists.none`, so
a locked list's _links_ drop out of every read path (browse, Show All, tags,
search, pins) until unlocked — but the list stays selectable as a _destination_.
So: lock gates a list's contents; hide only tidies the sidebar; neither touches
what the pickers offer. Don't re-add `hiddenListIds` to any picker's
`excludeIds` — it looks like a privacy fix but only breaks web/extension parity.

**The coupling to watch** — the reason an editor change reaches beyond the
editors:

- **The row menu's "Move to"** (`_layouts/shared.tsx`, `LinkRowMenu`) renders
  `ListCommand` **directly** — the same component `ListSelect` wraps. So a change
  to `list-command` (its props, its row shape, its `excludeIds`/`disabledIds`
  handling) hits the move-to menu too, not just the editors. It passes
  `excludeIds={[TRASH_ID]}` and `disabledIds={[link.listId]}` — trashing is the
  menu's Remove, never a "move", and the current list stays visible-but-disabled
  to keep the tree's shape intact.
- **The Lists settings "Move to"** (`_lists/lists-section.tsx`, `RowActions`)
  also embeds `ListCommand` — but it **reparents a list**, not a link, so it uses
  two things a link-move never does. It opts into `ListCommand`'s **`root`** prop
  to offer a "Top level" target (`parentId === null`, which has no list id — the
  reason `root` exists rather than a sentinel id); and its `excludeIds` is the
  row's whole **subtree** (`forbiddenParentIds` — self + descendants + no-children
  containers) so a list can't move under itself (cycle) or into Trash, with the
  current parent left visible-but-disabled (`value`/`disabledIds`) like the link
  menu. Because the pick comes from a `CommandItem` (not a `DropdownMenuItem`,
  which Radix would auto-close), that menu is **controlled** and closes itself on
  select — same pattern as `LinkRowMenu`. Drag-and-drop with depth projection is
  still the _primary_ reparent gesture there; this menu is the keyboard/mouse
  fallback. So `list-command`'s `root` prop now has two audiences: leave it out
  for link surfaces, opt in for reparenting.
- **The sidebar** (`_panes/sidebar.tsx`) does **not** use the shared picker
  components — it renders its own `NavTree`. But it renders it over the **same
  `useLists`/`useTags` trees** and the same `@stxapps/shared` tree helpers
  (`flattenTree`, `TreeNode`, `ancestorIds`). So the split is: a change to the
  picker _components_ does not touch the sidebar, but a change to the taxonomy's
  _shape_ (the entity schema, the tree helpers, the ordering/`parentId` model)
  hits the sidebar, the settings sections, and every picker at once. The sidebar
  also auto-expands an ancestor path when the selection changes (`expand`), so a
  list/tag chosen from an editor's `ListSelect` is never hidden under a collapsed
  parent.

### invariants every editor must uphold

These are the four rules the modal editors share. They exist because an editor is
**ephemeral draft state over a live, syncing store** — the store can change under
the form, and a stray click can drop the form.

**1. On open, copy values into draft state — don't bind to the store.** The edit
dialog snapshots `link.customTitle`/`listId`/`tagIds`/`note` into `useState` at
mount, and is `key`-remounted per open (and per retarget) so the draft always
starts fresh from the link. The quick-add popover resets its fields on
`onOpenChange(next=true)`. The reason is the writer-split + LWW: a background
extraction or another device can write the link mid-edit; a draft snapshot means
Save computes a **minimal patch** against the freshest blob
(`useLinkMutations.update` re-reads before merging) instead of binding to and
resurrecting stale fields.

**2. Validate inputs — cap text, resize images.** Two enforced facts:

- **Text caps** are `LINK_TITLE_MAX` (300) and `LINK_NOTE_MAX` (500) from
  `@stxapps/shared`. The editors set them as `maxLength` on the `Input`/`Textarea`
  (the friendly front-line), and the **entity schema enforces the same cap**
  (`z.string().max(LINK_TITLE_MAX)` on `customTitle`, `.max(LINK_NOTE_MAX)` on
  `note`) so a malformed write can't slip past. Discovered titles are capped by
  `cleanTitle` on the extraction side — same constant, so an override and an
  extracted title are bounded identically.
- **Image resize** is centralized in the data layer, not repeated per editor. The
  edit dialog is the only surface that picks a custom image; it routes the picked
  bytes through `useLinkMutations.saveCustomImage`, which caps dimensions via
  `resizeImage` (`packages/web-react/src/lib/resize-image.ts`,
  `createImageBitmap` + `OffscreenCanvas`, longest side ≤ 1024, re-encoded JPEG)
  before the blob lands in `files/{id}.enc`. `resizeImage` never throws — an
  undecodable input (SVG, corrupt bytes) falls back to the original, so a resize
  hiccup costs a larger blob, never the pick. **Any future editor that accepts
  image bytes must route them through `saveCustomImage` (or call `resizeImage`
  itself) — the per-user byte quota is the only backstop otherwise.** This is the
  same client-thumbnailing step the two capture tiers run
  (`server-extraction.ts`, the extension's `extraction-worker.ts`); the
  `brace-extractor` server deliberately never resizes (link-extraction.md). One
  exception by design: the extension's full-page **screenshot** capture is stored
  full-fidelity, not thumbnailed — resize's 1024px/JPEG spec is a preview spec,
  wrong for a faithful visual record.

**3. Guard the close so a stray click can't lose work.** The dialog and the
popover both compute a `dirty` flag that mirrors the patch Save would write
(`isDirty` in the dialog, `advancedDirty` in the popover), and **swallow only the
accidental close vectors** — backdrop click, Escape, the corner X — while dirty.
The explicit **Cancel** button calls `onClose`/`onOpenChange(false)` directly,
bypassing the guard, so a deliberate discard stays one click. Note the dirty check
is the _same_ field-by-field comparison the patch builder uses, so "dirty" means
exactly "Save would write something" — an untouched Save is a no-op that never
bumps `updatedAt` (which would reorder the date-modified sort). The extension's
popup editor has **no** close guard: a browser popup's close is the platform's
(it dismisses on focus loss, not interceptable), and it's create-only, so there's
less to lose — don't assume the invariant holds there.

### bulk edit

Bulk edit is a **mode**, not a separate editor: the topbar toggles `bulkEditing`
in `view-state-provider`, rows swap their options-menu slot for a `LinkRowSelect`
checkbox (`_layouts/shared.tsx` — sized to the menu trigger's footprint so row
geometry doesn't shift), and the `BulkEditToolbar` acts on the hoisted
`selectedLinks` map (keyed by the stable `link.path`).

- The selection lives in `view-state-provider` (not in a layout) because rows are
  virtualized — a layout-owned selection would be lost on repaint. `bulkEditing`
  is also one of the five guards that hold a background sync back, so rows can't
  shift mid-multi-select.
- **Navigating to another view exits bulk-edit mode.** Remove and Delete
  permanently mean different things per view, so a selection made in one view can
  never be acted on from another.
- Current actions are the view-split delete only — **Remove** (a reversible
  `update({ listId: TRASH_ID })`, no confirm) everywhere except Trash, where it's
  **Delete permanently** (irreversible → `requestDestroy` → `LinkDestroyConfirm`).
  Bulk **Move to** / **retag** are the natural next actions and should reuse the
  same `ListCommand`/`TagsField` pickers over the whole selection, exactly as the
  per-row menu does over one link — keep them consistent with §"shared pickers"
  when adding them.
