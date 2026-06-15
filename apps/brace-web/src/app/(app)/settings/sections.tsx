// The settings sections, defined once and shared by the sidebar (renders them as
// the nav rail), the topbar/main (name + render the active one). One source of
// truth keeps the menu, the labels, and the content switch from drifting apart.

import { CreditCard, Hash, Info, List, SlidersHorizontal, User } from 'lucide-react';

export type SettingsSectionId =
  | 'account'
  | 'subscription'
  | 'lists'
  | 'tags'
  | 'miscs'
  | 'about';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'account', label: 'Account', icon: <User className="size-4" /> },
  { id: 'subscription', label: 'Subscription', icon: <CreditCard className="size-4" /> },
  { id: 'lists', label: 'Lists', icon: <List className="size-4" /> },
  { id: 'tags', label: 'Tags', icon: <Hash className="size-4" /> },
  { id: 'miscs', label: 'Miscs.', icon: <SlidersHorizontal className="size-4" /> },
  { id: 'about', label: 'About', icon: <Info className="size-4" /> },
];

export const DEFAULT_SECTION_ID: SettingsSectionId = 'account';
