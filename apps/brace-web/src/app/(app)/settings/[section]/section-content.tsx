// A thin switch that renders the content for one settings section. Each section
// is its own component, so they can grow real forms independently — for now
// they're labelled placeholders. The section comes from the route param (see
// page.tsx alongside this file), so this is a plain prop-driven component: no hooks, no
// 'use client'. A section adds its own 'use client' when it grows interactivity.

import { SETTINGS_SECTIONS, type SettingsSectionId } from '../sections';

function Placeholder({ id }: { id: SettingsSectionId }) {
  const label = SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">{label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{label} settings coming soon.</p>
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

export function SectionContent({ section }: { section: SettingsSectionId }) {
  const Section = SECTIONS[section];
  return <Section />;
}
