import type { GlobalAction } from '@shapio/client';
import { Globe, KeyRound, MonitorSmartphone, Palette, UserRound, type LucideIcon } from 'lucide-react';

type SettingsPath =
  | '/settings/profile'
  | '/settings/sessions'
  | '/settings/theme'
  | '/settings/locales'
  | '/settings/api-tokens';

type SettingsSection = {
  key: 'profile' | 'sessions' | 'appearance' | 'locales' | 'apiTokens';
  to: SettingsPath;
  icon: LucideIcon;
  /** Hidden unless the admin holds this permission (the server enforces it either way). */
  permission?: GlobalAction;
};

export const SETTINGS_GROUPS: readonly {
  key: 'account' | 'workspace' | 'developer';
  sections: readonly SettingsSection[];
}[] = [
  {
    key: 'account',
    sections: [
      { key: 'profile', to: '/settings/profile', icon: UserRound },
      { key: 'sessions', to: '/settings/sessions', icon: MonitorSmartphone },
      { key: 'appearance', to: '/settings/theme', icon: Palette },
    ],
  },
  { key: 'workspace', sections: [{ key: 'locales', to: '/settings/locales', icon: Globe }] },
  {
    key: 'developer',
    sections: [{ key: 'apiTokens', to: '/settings/api-tokens', icon: KeyRound, permission: 'tokens.manage' }],
  },
];
