import { useState } from 'react';

import { DEFAULT_LIST_ID, LINK_NOTE_MAX, TRASH_ID } from '@stxapps/shared';
import { linkIdOf, type LinkItem, useLinkMutations } from '@stxapps/web-react';
import { ListSelect } from '@stxapps/web-ui/components/links/list-select';
import { TagsField } from '@stxapps/web-ui/components/links/tags-field';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Textarea } from '@stxapps/web-ui/components/ui/textarea';

import { type ActiveTab } from './App';

import { sendMessage } from '@/utils/messages';

// Signed-in, not-yet-saved: a popup-sized link editor for the active tab. URL is the
// tab's (read-only), plus the shared ListSelect / TagsField pickers (web-ui — the
// same pieces brace-web's quick-add popover and edit dialog render) and an optional
// note. Save writes one `links/{id}.enc`, kicks the cheap active-tab extraction
// (titleImage + readMode, fire-and-forget), and hands the created link up so the
// popup shows the complete page.
export function Editor({
  tab,
  url,
  onSaved,
}: {
  tab: ActiveTab;
  url: string;
  onSaved: (link: LinkItem) => void;
}) {
  const linkMutations = useLinkMutations();

  const [listId, setListId] = useState<string>(DEFAULT_LIST_ID);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const link = await linkMutations.create({ url, listId, tagIds, note });
      if (!link) {
        setSaving(false);
        return;
      }
      // Auto-run the cheap facets off the live DOM, fire-and-forget (heavy screenshot
      // / archive stay manual on the complete page — see link-extraction.md).
      const id = linkIdOf(link);
      void sendMessage({ type: 'EXTRACT', linkId: id, facet: 'titleImage' });

      onSaved(link);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-85 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Save to Brace</h1>

      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{tab.title || url}</p>
        <p className="truncate text-xs text-muted-foreground">{url}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="list">List</Label>
        {/* No Trash target: a fresh save never lands in the deletion staging area. */}
        <ListSelect id="list" value={listId} onValueChange={setListId} excludeIds={[TRASH_ID]} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tag">Tags</Label>
        <TagsField id="tag" value={tagIds} onChange={setTagIds} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea
          id="note"
          maxLength={LINK_NOTE_MAX}
          value={note}
          placeholder="Optional note"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}
