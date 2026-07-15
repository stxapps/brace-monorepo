import { useState } from 'react';

import { DEFAULT_LIST_ID, LINK_NOTE_MAX, PLAN_LABELS, TRASH_ID } from '@stxapps/shared';
import { linkIdOf, type LinkItem, useLinkMutations, useLinkQuota } from '@stxapps/web-react';
import { LinkQuotaBanner } from '@stxapps/web-ui/components/links/link-quota-banner';
import { ListSelect } from '@stxapps/web-ui/components/links/list-select';
import { TagsField } from '@stxapps/web-ui/components/links/tags-field';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Textarea } from '@stxapps/web-ui/components/ui/textarea';

import { type ActiveTab } from './App';

import { sendMessage } from '@/utils/messages';
import { WEB_APP_URL } from '@/utils/web-app-url';

// Signed-in, not-yet-saved: a popup-sized link editor for the active tab. URL is the
// tab's (read-only), plus the shared ListSelect / TagsField pickers (web-ui — the
// same pieces brace-web's quick-add popover and edit dialog render) and an optional
// note. Save writes one `links/{id}.enc`, kicks the cheap active-tab extraction
// (titleImage + readMode, fire-and-forget), and hands the created link up so the
// popup shows the complete page.
//
// A free library at its link cap replaces the whole editor with the shared
// LinkQuotaBanner (useLinkQuota) — in ~350px of popup there's no room to render a
// form that can't submit, and the save is genuinely unavailable: writing anyway
// would wedge the sync queue on the server's 403 (see the hook). Upgrading isn't a
// flow the extension owns, so the CTA opens the web app's subscription settings in
// a tab, the same hand-off SignIn makes for account creation.
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
  const { count, max, atLimit } = useLinkQuota();

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
      // / page copy stay manual on the complete page — see link-extraction.md).
      const id = linkIdOf(link);
      void sendMessage({ type: 'EXTRACT', linkId: id, facet: 'titleImage' });

      onSaved(link);
    } catch {
      setSaving(false);
    }
  }

  if (atLimit && max !== null) {
    return (
      <div className="flex w-85 flex-col gap-3 p-4">
        <h1 className="text-base font-semibold">Save to Brace</h1>
        <LinkQuotaBanner
          count={count}
          max={max}
          action={
            <Button
              size="sm"
              className="self-end"
              onClick={() => {
                void browser.tabs.create({ url: `${WEB_APP_URL}/settings/subscription` });
              }}
            >
              Upgrade to {PLAN_LABELS.plus}
            </Button>
          }
        />
      </div>
    );
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
