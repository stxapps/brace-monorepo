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
// titleImage facet backfills `title`/`imageId` in the background, and the live reads
// here pick it up), and manual Screenshot / Archive buttons that message the
// background to capture from the active tab. Each button reflects its facet's state
// read live from `extractions/{id}.enc`.
export function Complete({ link }: { link: LinkItem }) {
  const id = linkIdOf(link);
  // Re-read the link + extraction live so background backfills/captures show up.
  const liveLink = useLiveQuery(() => readLinkByUrl(link.url), [link.url]) ?? link;
  const extraction = useLiveQuery(() => readExtraction(id), [id]);
  const [busy, setBusy] = useState<Partial<Record<ExtractionFacet, boolean>>>({});

  const title = liveLink.customTitle ?? liveLink.title;
  const imageId = liveLink.customImageId ?? liveLink.imageId;
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
    <div className="popup">
      <div className="popup-header">
        <h1 className="popup-title">Saved ✓</h1>
        <button
          type="button"
          className="popup-link"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Status
        </button>
      </div>

      <div className="saved-preview">
        {imageUrl && <img className="saved-image" src={imageUrl} alt="" />}
        <p className="tab-title">{title || liveLink.url}</p>
        <p className="tab-url">{liveLink.url}</p>
      </div>

      <div className="facet-buttons">
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
