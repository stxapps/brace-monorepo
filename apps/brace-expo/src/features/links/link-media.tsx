// The item's image presentation chain — the expo port of brace-web's
// `_layouts/shared/link-media.tsx` (canonical doc for the chain's design: the
// deterministic Monogram, why the fallbacks are steady states, the fixed-size
// contract with the layouts). Shared by both link-item renderers (link-row,
// link-card). Divergences here:
//
//  - No Favicon component: the per-host favicon cache (web's FaviconProvider +
//    the extractor's image proxy) has no source on this platform yet, so every
//    fallback resolves straight to the monogram — web's own steady state when
//    serverExtraction is off. The chain keeps web's shape (icon | panel) so the
//    favicon slots in here, not in the renderers, when it lands.
//  - The image is core RN Image over the local plaintext `file://` uri
//    (useImageFileUri — content lives decrypted on disk, file-store.ts), the
//    same idiom as the edit screen's preview (setup.md: expo-image arrives
//    when it earns its keep).
//  - Monogram is a View tile, not SVG: its one consumer is the row's fixed
//    icon slot, so the letter size is fixed too (10/16 of the size-4 tile,
//    web's viewBox ratio) instead of scaling with the box.
//  - RN's color parser wants the comma hsl() syntax (web's space-separated
//    form isn't universally parsed), hence the style props.

import { Image, View } from 'react-native';

import { type LinkView, useImageFileUri } from '@stxapps/expo-react';
import { hostFromText, hueFromHost, initialFromHost } from '@stxapps/shared';

import { Text } from '../../components/ui/text';

// A deterministic monogram for a host — web's Monogram: an icon-less site still
// gets a consistent mark to recognize rows by, and the tile never changes under
// the user when a real favicon source later lands.
function Monogram({ host, className }: { host: string; className: string }) {
  return (
    <View
      aria-hidden
      className={`items-center justify-center ${className}`}
      style={{ backgroundColor: `hsl(${hueFromHost(host)}, 45%, 45%)` }}
    >
      <Text className="text-[10px] font-semibold text-white">{initialFromHost(host)}</Text>
    </View>
  );
}

// The image-less card fallback: a full-bleed panel painted with the host's hue
// (same hsl family as the Monogram tile) with a large centered letter, so an
// image-less card reads as an intentional colored block — web's
// PreviewFallbackPanel on its no-favicon branch, the only branch here.
function PreviewFallbackPanel({ host, className }: { host: string; className: string }) {
  return (
    <View
      className={`items-center justify-center ${className}`}
      style={{ backgroundColor: `hsl(${hueFromHost(host)}, 45%, 45%)` }}
    >
      <Text aria-hidden className="text-4xl font-semibold text-white/95">
        {initialFromHost(host)}
      </Text>
    </View>
  );
}

// The link's preview-image slot — web's LinkPreviewImage, verbatim in contract:
// `imageId` is the row's override-wins image ref (LinkView), read local-first
// and fetched on demand the moment the item mounts (FlashList items are
// virtualized, so mounted = displayed — useImageFileUri adds the settle delay).
// Until a uri exists — or when the link has no image at all — the slot shows a
// fallback keyed by `fallback`: the small monogram tile on a muted background
// (`icon`, the row's compact slot) or the full-bleed hue panel (`panel`, the
// card's banner). Either way the placeholder still identifies the link and the
// geometry never shifts — both call sites pass a FIXED-size `className` (the
// card's height budget depends on it).
export function LinkPreviewImage({
  link,
  className,
  iconClassName,
  fallback = 'icon',
}: {
  link: LinkView;
  className: string;
  iconClassName?: string;
  fallback?: 'icon' | 'panel';
}) {
  const uri = useImageFileUri(link.imageId);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        className={className}
      />
    );
  }

  const host = hostFromText(link.url);
  if (fallback === 'panel') {
    return <PreviewFallbackPanel host={host} className={className} />;
  }
  return (
    <View className={`bg-muted items-center justify-center ${className}`}>
      <Monogram host={host} className={iconClassName ?? ''} />
    </View>
  );
}
