import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  type ExtractionFacet,
  type LinkItem,
  readExtraction,
  readFileBytes,
  readLinkByUrl,
} from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { linkIdOf } from './App';

import { sendMessage } from '@/utils/messages';

type FacetButtonState = 'idle' | 'capturing' | 'done' | 'failed';

// The complete page — shown right after a save AND when the active tab is already
// saved (the revisit / bonus path). "Saved ✓", a reactive title/image preview (the
// titleImage facet fills `title`/`imageId` into the link's `extractions/{id}.enc` in
// the background, and the live reads here pick it up), and manual Screenshot / Archive
// buttons that message the background to capture from the active tab. Each button
// reflects its facet's state read live from the same extraction.
export function Complete({ link }: { link: LinkItem }) {
  const id = linkIdOf(link);
  // Re-read the link + extraction live so background backfills/captures show up. The
  // display title/image are the override-wins join of the two (the user's `custom*` on
  // the link, the extracted values on the extraction — the writer-split).
  const liveLink = useLiveQuery(() => readLinkByUrl(link.url), [link.url]) ?? link;
  const extraction = useLiveQuery(() => readExtraction(id), [id]);
  const [busy, setBusy] = useState<Partial<Record<ExtractionFacet, boolean>>>({});

  const title = liveLink.customTitle ?? extraction?.title;
  const imageId = liveLink.customImageId ?? extraction?.imageId;
  const imageBytes = useLiveQuery(
    () => (imageId ? readFileBytes(imageId) : Promise.resolve(undefined)),
    [imageId],
  );
  const imageUrl = useMemo(
    () => (imageBytes ? URL.createObjectURL(new Blob([imageBytes as BlobPart])) : undefined),
    [imageBytes],
  );
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  function facetState(facet: ExtractionFacet): FacetButtonState {
    if (busy[facet]) return 'capturing';
    const status = extraction?.facets?.[facet]?.status;
    if (status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    return 'idle';
  }

  async function run(facet: ExtractionFacet) {
    setBusy((b) => ({ ...b, [facet]: true }));
    try {
      await sendMessage({ type: 'EXTRACT', linkId: id, facet });
    } finally {
      setBusy((b) => ({ ...b, [facet]: false }));
    }
  }

  return (
    <div className="flex w-[340px] flex-col gap-3 p-4">
      <h1 className="m-0 text-base font-semibold">Saved ✓</h1>

      <div className="flex flex-col gap-0.5">
        {imageUrl && <img className="w-full rounded-[6px]" src={imageUrl} alt="" />}
        <p className="m-0 font-medium">{title || liveLink.url}</p>
        <p className="m-0 truncate text-xs text-muted-foreground">{liveLink.url}</p>
      </div>

      <div className="flex gap-2">
        <FacetButton
          label="Screenshot"
          state={facetState('screenshot')}
          onClick={() => run('screenshot')}
        />
        <FacetButton label="Archive" state={facetState('archive')} onClick={() => run('archive')} />
      </div>
    </div>
  );
}

function FacetButton({
  label,
  state,
  onClick,
}: {
  label: string;
  state: FacetButtonState;
  onClick: () => void;
}) {
  const text =
    state === 'capturing'
      ? 'Capturing…'
      : state === 'done'
        ? `${label} ✓`
        : state === 'failed'
          ? `${label} — retry`
          : label;
  return (
    <Button type="button" variant="outline" disabled={state === 'capturing'} onClick={onClick}>
      {text}
    </Button>
  );
}
