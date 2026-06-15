'use client';

// The main pane: a thin switch that renders the content for whichever section the
// sidebar selected. Each section is its own component, so they can grow real
// forms independently — for now they're labelled placeholders. This is the single
// place the section state meets the content.

import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections';
import { useSettingsPage } from './settings-page-provider';

function Placeholder({ id }: { id: SettingsSectionId }) {
  const label = SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">{label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {label} settings coming soon.
      </p>
    </div>
  );
}

const SECTIONS: Record<SettingsSectionId, () => React.ReactNode> = {
  account: () => <Placeholder id="account" />,
  subscription: () => <Placeholder id="subscription" />,
  lists: () => <Placeholder id="lists" />,
  tags: () => <Placeholder id="tags" />,
  miscs: () => <Placeholder id="miscs" />,
  about: () => <Placeholder id="about" />,
};

export function Main() {
  const { section } = useSettingsPage();
  const Section = SECTIONS[section];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <Section />
    </main>
  );
}
