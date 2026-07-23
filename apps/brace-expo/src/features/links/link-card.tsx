// Grid card item for `linksLayout: 'card'` — the expo port of brace-web's card
// (`_layouts/card-layout.tsx` is the canonical doc for the card anatomy).
// FlashList's `numColumns` replaces web's virtualize-by-rows-of-N chunking
// (see main.tsx), so this file is only the card itself.
//
// FIXED height, web's rationale: cards with less content keep the height so the
// grid rows stay aligned — content flows top-down and the unused space falls at
// the BOTTOM (reads as bottom padding, not a mid-card gap). Budget: preview
// slot (112 — image or fallback panel, fixed either way) + p-3 text block
// (host line 16 + gap 8 + two title lines 40 + padding 24) + one chip line +
// pb-3 (32) = 232. No date column (web parity)
// and no inline note text (NoteBadge only — web's fixed-estimate rationale).

import { Linking, Pressable, View } from 'react-native';

import { displayUrl, hostFromText } from '@stxapps/shared';

import { Checkbox } from '../../components/ui/checkbox';
import { Text } from '../../components/ui/text';
import { LinkPreviewImage } from './link-media';
import { LinkRowMenu } from './link-row-menu';
import { LinkTagChips } from './link-tag-chips';
import { type LinkItemProps, NoteBadge, PinnedBadge } from './shared';

const CARD_HEIGHT = 232;

export function LinkCard({
  link,
  pinned,
  isFirst,
  isLast,
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
        {/* The banner: the preview image once its bytes are resident (fetched
            on demand by mounting — link-media.tsx), else the full-bleed hue
            panel. Fixed h-28 either way (the height budget above). */}
        <LinkPreviewImage link={link} className="h-28 w-full" fallback="panel" />
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
        {/* Floats over the banner (web's corner slot: the row menu, swapped for
            the selection checkbox while bulk editing), so give it a readable
            backdrop. */}
        <View className="bg-background/60 absolute top-1 right-1 rounded-md">
          {selectMode ? (
            <View className="p-1">
              <Checkbox
                aria-label={`Select ${link.title || displayUrl(link.url)}`}
                checked={selected}
                onCheckedChange={onToggle}
              />
            </View>
          ) : (
            <LinkRowMenu link={link} pinned={pinned} isFirst={isFirst} isLast={isLast} />
          )}
        </View>
      </Pressable>
    </View>
  );
}
