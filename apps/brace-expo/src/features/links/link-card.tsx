// Grid card item for `linksLayout: 'card'` — the expo port of brace-web's card
// (`_layouts/card-layout.tsx` is the canonical doc for the card anatomy).
// FlashList's `numColumns` replaces web's virtualize-by-rows-of-N chunking
// (see main.tsx), so this file is only the card itself.
//
// FIXED height, web's rationale: cards with less content keep the height so the
// grid rows stay aligned — content flows top-down and the unused space falls at
// the BOTTOM (reads as bottom padding, not a mid-card gap). Budget: preview
// panel (112) + p-3 text block (host line 16 + gap 8 + two title lines 40 +
// padding 24) + one chip line + pb-3 (32) = 232. No date column (web parity)
// and no inline note text (NoteBadge only — web's fixed-estimate rationale).

import { Linking, Pressable, View } from 'react-native';

import { displayUrl, hostFromText, hueFromHost, initialFromHost } from '@stxapps/shared';

import { Checkbox } from '../../components/ui/checkbox';
import { Text } from '../../components/ui/text';
import { type LinkItemProps, LinkTagChips, NoteBadge, PinnedBadge } from './shared';

const CARD_HEIGHT = 232;

// The card's banner slot — web's LinkPreviewImage `fallback="panel"`: a
// full-bleed panel painted with the host's hue plus a large centered monogram
// letter, so an image-less card reads as an intentional colored block. On this
// platform it's the ONLY state for now — the real preview image (and web's
// favicon-on-white-chip variant) arrive with extraction + the file store. The
// letter/hue derivations live in @stxapps/shared so the same host paints
// identically here and on web. RN's color parser wants the comma hsl() syntax
// (web's space-separated form isn't universally parsed), hence the style prop.
function PreviewPanel({ host }: { host: string }) {
  return (
    <View
      className="h-28 w-full items-center justify-center"
      style={{ backgroundColor: `hsl(${hueFromHost(host)}, 45%, 45%)` }}
    >
      <Text aria-hidden className="text-4xl font-semibold text-white/95">
        {initialFromHost(host)}
      </Text>
    </View>
  );
}

export function LinkCard({
  link,
  pinned,
  tagsById,
  selectMode,
  selected,
  onToggle,
}: LinkItemProps) {
  const host = hostFromText(link.url);

  return (
    // p-2 is half the 16pt grid gutter: with the pane's matching content padding
    // (main.tsx CARD_GRID_PADDING), edges and inter-card gaps both come to 16 —
    // web's p-4 container + gap-4 grid.
    <View className="p-2">
      <Pressable
        onPress={() => (selectMode ? onToggle() : void Linking.openURL(link.url))}
        accessibilityState={selectMode ? { selected } : undefined}
        style={{ height: CARD_HEIGHT }}
        className={`border-border overflow-hidden rounded-lg border ${
          selected ? 'bg-muted' : 'active:bg-muted/50'
        }`}
      >
        <PreviewPanel host={host} />
        <View className="gap-2 p-3">
          <View className="flex-row items-center gap-1.5">
            {pinned && <PinnedBadge />}
            {link.note !== undefined && link.note !== '' && <NoteBadge />}
            <Text numberOfLines={1} className="text-muted-foreground min-w-0 flex-1 text-xs">
              {host}
            </Text>
          </View>
          <Text numberOfLines={2} className="text-sm font-medium">
            {link.title || displayUrl(link.url)}
          </Text>
        </View>
        <LinkTagChips link={link} tagsById={tagsById} className="px-3 pb-3" />
        {/* Floats over the banner (web's corner slot, minus the row menu — not
            on this platform yet), so give it a readable backdrop. */}
        {selectMode && (
          <View className="bg-background/60 absolute top-1 right-1 rounded-md p-1">
            <Checkbox
              aria-label={`Select ${link.title || displayUrl(link.url)}`}
              checked={selected}
              onCheckedChange={onToggle}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}
