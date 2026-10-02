import { linkOptions, type LinkOptions } from '@tanstack/react-router';
import { Boxes, FilePlus2, ImageUp, UserPlus, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import type { ModelSummary } from './useModelSummaries';

export type ShortcutItem = { key: string; label: string; icon: LucideIcon; link: LinkOptions };

/** "Create entry" goes straight to the model when there is exactly one; otherwise to the content screen. */
const createEntryLink = (models: readonly ModelSummary[]): LinkOptions => {
  const [only] = models;
  if (models.length !== 1 || !only) {
    return linkOptions({ to: '/content' });
  }
  return only.kind === 'collection'
    ? linkOptions({ to: '/content/$modelKey/new', params: { modelKey: only.apiKey } })
    : linkOptions({ to: '/content/$modelKey', params: { modelKey: only.apiKey } });
};

/** The shortcuts this admin can use: entries need a model; the rest need their permission. */
export const useShortcuts = (models: readonly ModelSummary[] | undefined): ShortcutItem[] => {
  const { t } = useTranslation();
  const canCreateModels = useHasGlobalPermission('schema.create');
  const canUpload = useHasGlobalPermission('media.write');
  const canInvite = useHasGlobalPermission('users.manage');
  return [
    ...(models && models.length > 0
      ? [{ key: 'entry', label: t('home.createEntry'), icon: FilePlus2, link: createEntryLink(models) }]
      : []),
    ...(canCreateModels
      ? [{ key: 'model', label: t('home.newModel'), icon: Boxes, link: linkOptions({ to: '/content/new' }) }]
      : []),
    ...(canUpload
      ? [{ key: 'media', label: t('home.uploadMedia'), icon: ImageUp, link: linkOptions({ to: '/media' }) }]
      : []),
    ...(canInvite
      ? [{ key: 'invite', label: t('home.invite'), icon: UserPlus, link: linkOptions({ to: '/users' }) }]
      : []),
  ];
};
