import { useState } from 'react';
import { X } from 'lucide-react';

import { DEFAULT_LIST_ID, flattenTree } from '@stxapps/shared';
import {
  type LinkItem,
  type TagItem,
  useLinkMutations,
  useLists,
  useTagMutations,
} from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@stxapps/web-ui/components/ui/select';
import { Textarea } from '@stxapps/web-ui/components/ui/textarea';

import { type ActiveTab, linkIdOf } from './App';

import { sendMessage } from '@/utils/messages';

// Signed-in, not-yet-saved: a popup-sized link editor for the active tab. URL is the
// tab's (read-only), plus a list picker, free-text tags, and an optional note —
// reusing the shared useLists / useTagMutations / useLinkMutations hooks. Save writes
// one `links/{id}.enc`, kicks the cheap active-tab extraction (titleImage + readMode,
// fire-and-forget), and hands the created link up so the popup shows the complete page.
export function Editor({
  tab,
  url,
  onSaved,
}: {
  tab: ActiveTab;
  url: string;
  onSaved: (link: LinkItem) => void;
}) {
  const lists = useLists();
  const flatLists = flattenTree(lists);
  const linkMutations = useLinkMutations();
  const tagMutations = useTagMutations();

  const [listId, setListId] = useState<string>(DEFAULT_LIST_ID);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    const tag = await tagMutations.findOrCreate(name);
    if (tag && !tags.some((t) => t.id === tag.id)) setTags((prev) => [...prev, tag]);
    setTagInput('');
  }

  async function save() {
    setSaving(true);
    try {
      const link = await linkMutations.create({
        url,
        listId,
        tagIds: tags.map((t) => t.id),
        note,
      });
      if (!link) {
        setSaving(false);
        return;
      }
      // Auto-run the cheap facets off the live DOM, fire-and-forget (heavy screenshot
      // / archive stay manual on the complete page — see link-extraction.md).
      const id = linkIdOf(link);
      void sendMessage({ type: 'EXTRACT', linkId: id, facet: 'titleImage' });
      void sendMessage({ type: 'EXTRACT', linkId: id, facet: 'readMode' });
      onSaved(link);
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-[340px] flex-col gap-3 p-4">
      <h1 className="m-0 text-base font-semibold">Save to Brace</h1>

      <div className="flex flex-col gap-0.5">
        <p className="m-0 font-medium">{tab.title || url}</p>
        <p className="m-0 truncate text-xs text-muted-foreground">{url}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="list">List</Label>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger id="list">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {flatLists.map(({ item, depth }) => (
              <SelectItem key={item.id} value={item.id}>
                <span style={{ paddingLeft: depth * 12 }}>{item.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tag">Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
              >
                {tag.name}
                <button
                  type="button"
                  aria-label={`Remove ${tag.name}`}
                  className="inline-flex cursor-pointer border-0 bg-transparent p-0"
                  onClick={() => setTags((prev) => prev.filter((t) => t.id !== tag.id))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <Input
            id="tag"
            value={tagInput}
            placeholder="Add a tag"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTag();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={!tagInput.trim()} onClick={addTag}>
            Add
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea
          id="note"
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
