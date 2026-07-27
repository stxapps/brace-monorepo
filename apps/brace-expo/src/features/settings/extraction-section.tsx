// The Link previews settings section — the expo port of brace-web's
// `(app)/settings/[section]/_extraction/extraction-section.tsx` (that header is
// canonical: a thin controls surface over the provider's drain, with the opt-in
// colocated beside the controls it governs rather than split off into Misc).
// Same three parts — the toggle, the exact facet counts, the full-library
// controls — with three deliberate omissions and one addition:
//
//  - NO PLAN GATE / UPSELL. Web gates server extraction behind a Plus
//    entitlement because it's a paid, abuse-exposed server path; on-device
//    extraction costs the project nothing, so it's free on every plan
//    (docs/link-extraction.md — _expo drains in the foreground_).
//  - NO TWO-STEP CONFIRM on "Generate all". Web confirms because the job can be
//    thousands of PAID requests. Here nothing is billed — so the button acts
//    immediately, and the honest disclosure ("uses your connection") is stated
//    up front instead of interposed as a modal step.
//  - NO `serverExtraction` TOGGLE. Expo never calls brace-extractor, so a switch
//    whose effect is invisible on the device holding it would be worse than no
//    switch; the setting is round-tripped for the web clients and never read
//    here (use-setting-mutations).
//  - The toggle it DOES render is `deviceExtraction`, and its copy has to carry
//    the gestured/un-gestured split honestly: links saved on this device are
//    previewed either way, so what the switch buys is the RESIDUAL — links that
//    arrived by sync from another device or by import.

import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Pause, Sparkles } from 'lucide-react-native';

import {
  useExtraction,
  useExtractionCounts,
  useSettingMutations,
  useSettings,
} from '@stxapps/expo-react';

import { Button } from '../../components/ui/button';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';

// One labelled count in a bordered tile — web's Stat, in RN boxes.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View className="border-border flex-1 gap-0.5 rounded-lg border p-3">
      <Text className="text-2xl font-semibold tabular-nums">{value}</Text>
      <Text className="text-muted-foreground text-sm">{label}</Text>
    </View>
  );
}

export function ExtractionSection() {
  const { enabled, isRunning, isExtractingAll, autoLimitReached, extractAll, pause } =
    useExtraction();
  const { done: doneCount, pending: pendingCount, failed: failedCount } = useExtractionCounts();

  // The opt-in itself. `enabled` above is the composite gate (signed in + store
  // ready + this), so the switch binds to the raw setting — flipping it on while
  // the store is still opening still persists the preference.
  const { deviceExtraction } = useSettings();
  const { setDeviceExtraction } = useSettingMutations();

  // Surface a failed write (e.g. no active account) rather than swallowing it;
  // the control stays live for a retry. MiscSection's `run`, verbatim.
  const [error, setError] = useState<string | null>(null);
  const setOptIn = (next: boolean) => {
    setError(null);
    void setDeviceExtraction(next).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };

  const total = doneCount + pendingCount + failedCount;

  return (
    <View className="px-6 py-8">
      <Text role="heading" className="text-xl font-semibold">
        Link previews
      </Text>
      <Text className="text-muted-foreground mt-1 mb-6 text-sm">
        Brace fills in each saved link&apos;s title and preview image automatically — you don&apos;t
        need to do it by hand. Links you save on this device are previewed right here, on the phone:
        the page is fetched by the app itself, so no server of ours ever sees it.
      </Text>

      <View className="border-border flex-row items-start justify-between gap-4 rounded-lg border p-4">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-medium">Preview links from your other devices</Text>
          <Text className="text-muted-foreground text-sm">
            Also fetch previews for links that arrived by sync or by import — pages this device
            hasn&apos;t opened. It uses your connection, and each site you saved sees a request from
            this device.
          </Text>
        </View>
        <Switch value={deviceExtraction} onValueChange={setOptIn} />
      </View>

      {error && (
        <View className="bg-destructive/10 mt-4 rounded-md px-3 py-2">
          <Text className="text-destructive text-sm">{error}</Text>
        </View>
      )}

      {deviceExtraction && !enabled ? (
        <View className="bg-muted/50 mt-6 rounded-md px-3 py-2">
          <Text className="text-muted-foreground text-sm">
            Previews are on but paused — they resume once you&apos;re signed in and your links have
            finished loading.
          </Text>
        </View>
      ) : enabled ? (
        <View className="mt-6">
          <View className="flex-row gap-3">
            <Stat label="With preview" value={doneCount} />
            <Stat label="Pending" value={pendingCount} />
            <Stat label="Failed" value={failedCount} />
          </View>

          <Text className="text-muted-foreground mt-4 text-sm">
            {total === 0
              ? 'No links to preview yet.'
              : `${doneCount} of ${total} link${total === 1 ? '' : 's'} previewed.`}
          </Text>

          {autoLimitReached && !isExtractingAll && (
            <View className="bg-muted/50 mt-4 rounded-md px-3 py-2">
              <Text className="text-muted-foreground text-sm">
                Automatic previews paused for now. Use{' '}
                <Text className="text-muted-foreground text-sm font-semibold">Generate all</Text> to
                finish the remaining links.
              </Text>
            </View>
          )}

          <View className="mt-6 flex-row">
            {isExtractingAll ? (
              <Button variant="outline" onPress={pause}>
                <Icon as={Pause} className="size-4" />
                <Text>{isRunning ? 'Generating… Pause' : 'Pause'}</Text>
              </Button>
            ) : (
              <Button variant="outline" disabled={pendingCount === 0} onPress={extractAll}>
                <Icon as={Sparkles} className="size-4" />
                <Text>Generate all</Text>
              </Button>
            )}
          </View>
          <Text className="text-muted-foreground mt-2 text-sm">
            Generating fetches every pending link over your connection — best on Wi-Fi, and keep the
            app open while it runs.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
