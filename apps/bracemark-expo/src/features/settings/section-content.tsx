// A thin switch that renders the content for one settings section — the expo
// port of bracemark-web's `(app)/settings/[section]/section-content.tsx`. Each
// section is its own component, so they can grow independently. The section
// comes from the route param (see `(app)/settings/[section].tsx`), so this is
// a plain prop-driven component. `about` stays a labelled placeholder, exactly
// like web's.

import { AccountSection } from './account-section';
import { DataSection } from './data-section';
import { ExtractionSection } from './extraction-section';
import { ListsSection } from './lists-section';
import { MiscSection } from './misc-section';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
import { SettingsHeader, SettingsPane } from './settings-kit';
import { SubscriptionSection } from './subscription-section';
import { TagsSection } from './tags-section';

// Still a placeholder, exactly like web's — but rendered through the kit, so an
// unbuilt section sits at the same inset and heading step as the seven real
// ones instead of announcing itself as unfinished by being shaped differently.
function Placeholder({ id }: { id: SettingsSectionId }) {
  const label = SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;
  return (
    <SettingsPane>
      <SettingsHeader title={label} description={`${label} settings coming soon.`} />
    </SettingsPane>
  );
}

const SECTIONS: Record<SettingsSectionId, () => React.ReactNode> = {
  account: () => <AccountSection />,
  subscription: () => <SubscriptionSection />,
  data: () => <DataSection />,
  extraction: () => <ExtractionSection />,
  lists: () => <ListsSection />,
  tags: () => <TagsSection />,
  misc: () => <MiscSection />,
  about: () => <Placeholder id="about" />,
};

export function SectionContent({ section }: { section: SettingsSectionId }) {
  const Section = SECTIONS[section];
  return <Section />;
}
