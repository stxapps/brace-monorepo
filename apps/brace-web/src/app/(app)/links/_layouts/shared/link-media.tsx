'use client';

// The row's icon/image presentation chain: a deterministic Monogram fallback,
// the site Favicon that falls back to it, and the LinkPreviewImage slot that
// falls back to the favicon. Shared by both link layouts.

import { hostFromText } from '@stxapps/shared';
import { type LinkView, useFaviconUrl, useImageFileUrl } from '@stxapps/web-react';

// A deterministic monogram for a host — the favicon's stand-in. Pure and stable:
// the same host always draws the same letter on the same color, so an icon-less
// site still gets a consistent mark to recognize rows by (and the tile never
// changes under the user when the real icon later lands).
//
// SVG, not a styled div, so ONE component serves every call site's box (size-4 in
// the rows, size-6 in the preview slot) — the viewBox scales the letter with the
// tile, where a Tailwind text size would have to be passed in per caller and kept
// in sync with it.
function Monogram({ host, className }: { host: string; className: string }) {
  const letter = (/[a-z0-9]/i.exec(host)?.[0] ?? '?').toUpperCase();
  // Cheap string hash → hue. Only the HUE varies: saturation/lightness are fixed at
  // values where white text stays legible on every hue, and the tile carries its own
  // background, so it reads the same in light and dark theme.
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;

  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect width="16" height="16" rx="3" fill={`hsl(${hue} 45% 45%)`} />
      <text
        x="8"
        y="8.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontWeight="600"
        fill="#fff"
      >
        {letter}
      </text>
    </svg>
  );
}

// The site's favicon, keyed by DISPLAY HOST (`hostFromText`, so it matches the
// host string rendered beside it) — cached per host in Dexie and fetched at most
// once per host per device through the extractor's image proxy (useFaviconUrl /
// favicon-provider). This replaces the old Google s2/favicons call, which
// disclosed every rendered link's host to Google and was the last third-party leak
// in the app.
//
// Falls back to the monogram whenever there are no bytes to show — while the fetch
// is in flight, for a host with no reachable favicon, and (by design, not failure)
// for every host when the serverExtraction opt-in is off. So the fallback is a
// steady state, not just a loading state.
export function Favicon({ host, className }: { host: string; className: string }) {
  const url = useFaviconUrl(host);
  if (!url) return <Monogram host={host} className={className} />;
  // object-contain, not cover: a favicon is a whole mark, so it letterboxes rather
  // than crops (unlike the preview image, which is a photo being filled into a box).
  return <img src={url} alt="" className={`object-contain ${className}`} />;
}

// The link's preview-image slot. The resolved bytes are local-first: `imageId`
// is the row's override-wins image ref (LinkView), read from Dexie and fetched
// on demand by useImageFileUrl the moment the row mounts (rows are virtualized,
// so mounted = displayed). Until bytes exist — or when the link has no image at
// all — the slot shows the site favicon on a muted background, so the
// placeholder still identifies the link and the geometry never shifts. Both
// call sites pass a FIXED-size `className` (the layouts' row estimates depend
// on it).
export function LinkPreviewImage({
  link,
  className,
  iconClassName,
}: {
  link: LinkView;
  className: string;
  iconClassName: string;
}) {
  const url = useImageFileUrl(link.imageId);

  if (url) {
    return <img src={url} alt="" className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-muted ${className}`}>
      <Favicon host={hostFromText(link.url)} className={iconClassName} />
    </div>
  );
}
