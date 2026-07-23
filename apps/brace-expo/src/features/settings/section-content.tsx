// A thin switch that renders the content for one settings section — the expo
// port of brace-web's `(app)/settings/[section]/section-content.tsx`. Each
// section is its own component, so they can grow independently. The section
// comes from the route param (see `(app)/settings/[section].tsx`), so this is
// a plain prop-driven component. `about` stays a labelled placeholder, exactly
// like web's; there is no `extraction` entry (see sections.ts).

import { View } from 'react-native';

import { Text } from '../../components/ui/text';
import { AccountSection } from './account-section';
import { DataSection } from './data-section';
import { ListsSection } from './lists-section';
import { MiscSection } from './misc-section';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
import { SubscriptionSection } from './subscription-section';
import { TagsSection } from './tags-section';

function Placeholder({ id }: { id: SettingsSectionId }) {
  const label = SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;
  return (
    <View className="px-6 py-8">
      <Text role="heading" className="text-xl font-semibold">
        {label}
      </Text>
      <Text className="text-muted-foreground mt-2 text-sm">{label} settings coming soon.</Text>
    </View>
  );
}

const SECTIONS: Record<SettingsSectionId, () => React.ReactNode> = {
  account: () => <AccountSection />,
  subscription: () => <SubscriptionSection />,
  data: () => <DataSection />,
  lists: () => <ListsSection />,
  tags: () => <TagsSection />,
  misc: () => <MiscSection />,
  about: () => <Placeholder id="about" />,
};

export function SectionContent({ section }: { section: SettingsSectionId }) {
  const Section = SECTIONS[section];
  return <Section />;
}
