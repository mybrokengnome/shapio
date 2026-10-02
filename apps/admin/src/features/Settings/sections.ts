import type { GlobalAction } from '@shapio/client';
import {
  Globe,
  KeyRound,
  MonitorSmartphone,
  Palette,
  ScrollText,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

type SettingsPath =
  | '/settings/profile'
  | '/settings/sessions'
  | '/settings/theme'
  | '/settings/locales'
  | '/settings/roles'
  | '/settings/api-tokens'
  | '/settings/audit-log';

type SettingsSection = {
  key: 'profile' | 'sessions' | 'appearance' | 'locales' | 'roles' | 'apiTokens' | 'auditLog';
  to: SettingsPath;
  icon: LucideIcon;
  /** Hidden unless the admin holds this permission (the server enforces it either way). */
  permission?: GlobalAction;
};

export const SETTINGS_GROUPS: readonly {
  key: 'account' | 'workspace' | 'access' | 'developer';
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
  { key: 'access', sections: [{ key: 'roles', to: '/settings/roles', icon: ShieldCheck }] },
  {
    key: 'developer',
    sections: [
      { key: 'apiTokens', to: '/settings/api-tokens', icon: KeyRound, permission: 'tokens.manage' },
      { key: 'auditLog', to: '/settings/audit-log', icon: ScrollText, permission: 'audit.read' },
    ],
  },
];
