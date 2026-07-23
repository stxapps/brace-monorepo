// Dense one-row-per-link item, the default `linksLayout` — the expo port of
// brace-web's list-layout row (`_layouts/list-layout.tsx` is the canonical doc
// for the row anatomy). Text-first: the preview image / favicon need the file
// store and a favicon source, which arrive with extraction support on this
// platform.
//
// The date column shows the field the rows are SORTED by (web's rationale:
// relative values must read top-to-bottom in order). Formatted by hand rather
// than Intl.RelativeTimeFormat — Hermes' Intl coverage is uneven across
// platforms, and the compact "3d" style suits the narrow column anyway.

import { Linking, Pressable, View } from 'react-native';

import { displayUrl, hostFromText } from '@stxapps/shared';

import { Checkbox } from '../../components/ui/checkbox';
import { Text } from '../../components/ui/text';
import { LinkRowMenu } from './link-row-menu';
import { LinkTagChips } from './link-tag-chips';
import { type LinkItemProps, NoteBadge, PinnedBadge } from './shared';

const MINUTE = 60 * 1000;
const RELATIVE_UNITS: [string, number][] = [
  ['y', 365 * 24 * 60 * MINUTE],
  ['mo', 30 * 24 * 60 * MINUTE],
  ['w', 7 * 24 * 60 * MINUTE],
  ['d', 24 * 60 * MINUTE],
  ['h', 60 * MINUTE],
  ['m', MINUTE],
];

// Compact "3d" / "2mo" for the date column: the largest unit that fits.
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (diff >= ms) return `${Math.round(diff / ms)}${unit}`;
  }
  return 'now';
}

export function LinkRow({
  link,
  pinned,
  isFirst,
  isLast,
  sortOn,
  tagsById,
  selectMode,
  selected,
  onToggle,
}: LinkItemProps) {
  return (
    <Pressable
      onPress={() => (selectMode ? onToggle() : void Linking.openURL(link.url))}
      accessibilityState={selectMode ? { selected } : undefined}
      className="border-border active:bg-muted/50 flex-row items-center gap-3 border-b py-3 pr-2 pl-4"
    >
      {selectMode && (
        <Checkbox
          aria-label={`Select ${link.title || displayUrl(link.url)}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="shrink-0"
        />
      )}
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          {pinned && <PinnedBadge />}
          {link.note !== undefined && link.note !== '' && <NoteBadge />}
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium">
            {link.title || displayUrl(link.url)}
          </Text>
        </View>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {hostFromText(link.url)}
        </Text>
        <LinkTagChips link={link} tagsById={tagsById} className="mt-1" />
      </View>
      <Text className="text-muted-foreground shrink-0 text-xs">
        {formatRelativeTime(link[sortOn])}
      </Text>
      {/* Hidden while selecting — the checkbox column stands in (web's list
          layout, verbatim). */}
      {!selectMode && <LinkRowMenu link={link} pinned={pinned} isFirst={isFirst} isLast={isLast} />}
    </Pressable>
  );
}
