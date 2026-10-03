import { linkOptions } from '@tanstack/react-router';
import { Blocks, FilePlus2, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { usePaletteItems } from '@/components/CommandPalette/hooks/usePaletteItems';
import type { PaletteItem } from '@/components/CommandPalette/types';
import { SETTINGS_GROUPS } from '@/features/Settings/sections';
import { canSeeNetwork } from '@/helpers/sites';
import { isVisible, NETWORK_ITEMS } from '../navItems';
import { useNavAccess } from './useNavAccess';
import { usePlaces } from './usePlaces';
import type { ShellNavGroup } from './useShellNavGroups';

/**
 * Every sidebar destination, then the settings pages and (for network admins, from any site) the network
 * pages the sidebar doesn't list, once each.
 */
const useGoToItems = (groups: readonly ShellNavGroup[]): PaletteItem[] => {
  const { t } = useTranslation();
  const access = useNavAccess();
  const { data: me } = useMe();
  return useMemo(() => {
    const items: PaletteItem[] = groups.flatMap((group) =>
      group.items.flatMap((item) =>
        item.variant !== 'add'
          ? [
              {
                id: `goto:${item.key}`,
                label: item.label,
                icon: item.icon,
                link: item.link,
                ...(group.label ? { hint: group.label } : {}),
              },
            ]
          : [],
      ),
    );
    const listed = new Set(items.map((item) => String(item.link?.to)));
    const settings = SETTINGS_GROUPS.flatMap((group) => group.sections)
      .filter((section) => isVisible(section, access) && !listed.has(section.to))
      .map((section): PaletteItem => ({
        id: `goto:settings:${section.key}`,
        label: t(`settings.${section.key}`),
        hint: t('shell.nav.settings'),
        icon: section.icon,
        link: linkOptions({ to: section.to }),
      }));
    const network = canSeeNetwork(me)
      ? NETWORK_ITEMS.filter((item) => isVisible(item, access) && !listed.has(item.to)).map(
          (item): PaletteItem => ({
            id: `goto:network:${item.key}`,
            label: t(item.labelKey),
            hint: t('shell.groups.network'),
            icon: item.icon,
            link: linkOptions({ to: item.to }),
          }),
        )
      : [];
    return [...items, ...settings, ...network];
  }, [groups, access, me, t]);
};

/** "New Article" for each place the admin may add to, then a new content type or component. */
const useCreateItems = (): PaletteItem[] => {
  const { t } = useTranslation();
  const access = useNavAccess();
  const places = usePlaces();
  return useMemo(
    () => [
      ...(places ?? [])
        .filter((place) => place.kind === 'collection' && place.canCreate)
        .map((place): PaletteItem => ({
          id: `create:${place.id}`,
          label: t('palette.newEntry', { name: place.label }),
          keywords: [place.apiKey],
          icon: FilePlus2,
          link: linkOptions({ to: '/content/$modelKey/new', params: { modelKey: place.apiKey } }),
        })),
      ...(access.canCreateType
        ? [
            {
              id: 'create:type',
              label: t('shell.nav.newType'),
              icon: Plus,
              link: linkOptions({ to: '/content/new' }),
            },
            {
              id: 'create:component',
              label: t('palette.newComponent'),
              icon: Blocks,
              link: linkOptions({ to: '/develop/components/new' }),
            },
          ]
        : []),
    ],
    [places, access.canCreateType, t],
  );
};

/** Offers the shell's destinations and create actions in the ⌘K palette while signed in. */
export const useShellPaletteItems = (groups: readonly ShellNavGroup[]) => {
  usePaletteItems('goto', useGoToItems(groups));
  usePaletteItems('create', useCreateItems());
};
