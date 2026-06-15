import { notFound } from 'next/navigation';

import { isSettingsSectionId } from '../sections';
import { SectionContent } from './section-content';

// One settings section, addressed by its id in the path (`/settings/lists`, …).
// The id is user-supplied, so validate it against the known sections — anything
// else 404s. The shared frame (sidebar, topbar) lives in the layout; this page
// just renders the matching content.
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isSettingsSectionId(section)) notFound();

  return <SectionContent section={section} />;
}
