import { linkOptions, type LinkOptions } from '@tanstack/react-router';
import { FileStack, FileText, Plus, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import {
  CONTENT_ITEMS,
  DEVELOP_ITEMS,
  INBOX_ITEM,
  isVisible,
  NETWORK_ITEMS,
  WORKSPACE_ITEMS,
  type NavAccess,
  type NavItemDefinition,
} from '../navItems';
import { useIsNetworkView } from './useIsNetworkView';
import { useNavAccess } from './useNavAccess';
import { usePlaces, type Place } from './usePlaces';

export type ShellNavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  link: LinkOptions;
  /** Matches only its own path, not the paths below it (the Inbox at `/`). */
  exact?: boolean;
  /** Entries in a place. */
  count?: number;
  /** The quiet "+ New" row at the end of the places. */
  variant?: 'add';
  /** A place shared with all sites (marked only where there is more than one site). */
  shared?: boolean;
};

export type ShellNavGroup = {
  key: 'inbox' | 'places' | 'library' | 'develop' | 'workspace' | 'network';
  label?: string;
  items: ShellNavItem[];
};

const PLACE_ICONS = { collection: FileStack, singleton: FileText } as const;

export const fromDefinitions = (
  definitions: readonly NavItemDefinition[],
  access: NavAccess,
  label: (item: NavItemDefinition) => string,
): ShellNavItem[] =>
  definitions
    .filter((item) => isVisible(item, access))
    .map((item) => ({
      key: item.key,
      label: label(item),
      icon: item.icon,
      link: linkOptions({ to: item.to }),
      ...(item.exact ? { exact: true } : {}),
    }));

const placeItem = (place: Place, multiSite: boolean): ShellNavItem => ({
  key: `place:${place.id}`,
  label: place.label,
  icon: PLACE_ICONS[place.kind],
  link: linkOptions({ to: '/content/$modelKey', params: { modelKey: place.apiKey } }),
  ...(place.count === undefined ? {} : { count: place.count }),
  ...(multiSite && place.shared ? { shared: true } : {}),
});

/** The network view's one group: sites, admin users, roles and the audit log, as permitted. */
const useNetworkNavGroups = (enabled: boolean): ShellNavGroup[] => {
  const { t } = useTranslation();
  const access = useNavAccess();
  return useMemo(
    () =>
      enabled
        ? [
            {
              key: 'network',
              label: t('shell.groups.network'),
              items: fromDefinitions(NETWORK_ITEMS, access, (item) => t(item.labelKey)),
            },
          ]
        : [],
    [enabled, access, t],
  );
};

/**
 * The sidebar's groups for this admin: Inbox, the places (content types from the registry, with counts and
 * "+ New" for `schema.create`), Media and Publishing; Develop and Workspace when permitted. The word
 * "Models" is never shown (plan editor-experience §6). On network pages, the network group instead.
 */
export const useShellNavGroups = (): ShellNavGroup[] => {
  const isNetworkView = useIsNetworkView();
  const siteGroups = useSiteNavGroups(!isNetworkView);
  const networkGroups = useNetworkNavGroups(isNetworkView);
  return isNetworkView ? networkGroups : siteGroups;
};

const useSiteNavGroups = (enabled: boolean): ShellNavGroup[] => {
  const { t } = useTranslation();
  const access = useNavAccess();
  const places = usePlaces();
  const { multiSite } = useSchemaScopeAccess();
  return useMemo(() => {
    if (!enabled) {
      return [];
    }
    const label = (item: NavItemDefinition) => t(item.labelKey);
    const placeItems = (places ?? []).map((place) => placeItem(place, multiSite));
    const addType: ShellNavItem[] = access.canCreateType
      ? [
          {
            key: 'newType',
            label: t('shell.nav.newType'),
            icon: Plus,
            link: linkOptions({ to: '/content/new' }),
            variant: 'add',
          },
        ]
      : [];
    const groups: ShellNavGroup[] = [
      { key: 'inbox', items: fromDefinitions([INBOX_ITEM], access, label) },
      { key: 'places', label: t('shell.groups.content'), items: [...placeItems, ...addType] },
      { key: 'library', items: fromDefinitions(CONTENT_ITEMS, access, label) },
      ...(access.develop
        ? [
            {
              key: 'develop' as const,
              label: t('shell.groups.develop'),
              items: fromDefinitions(DEVELOP_ITEMS, access, label),
            },
          ]
        : []),
      {
        key: 'workspace',
        label: t('shell.groups.workspace'),
        items: fromDefinitions(WORKSPACE_ITEMS, access, label),
      },
    ];
    return groups.filter((group) => group.items.length > 0);
  }, [enabled, access, places, multiSite, t]);
};
