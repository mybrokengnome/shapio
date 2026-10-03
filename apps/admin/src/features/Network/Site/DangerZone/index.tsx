import type { Site } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteSite } from '@/api/sites';
import { currentSite } from '@/app/currentSite';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';

type DangerZoneProps = { site: Site };

/**
 * Deleting a site: only an empty one (no entries, media, folders, change sets or app users), never the
 * primary one. The server says which (`SITE_NOT_EMPTY`, `SITE_IS_PRIMARY`); the confirmation shows it.
 */
export const DangerZone = ({ site }: DangerZoneProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deleteSite = useDeleteSite();
  const remove = async () => {
    await deleteSite.mutateAsync(site);
    // Deleting this page load's own site reloads the sites list instead (see useDeleteSite).
    if (site.key !== currentSite().key) {
      toast.success(t('sites.deleted', { name: site.name }));
      void navigate({ to: '/network/sites' });
    }
  };
  return (
    <Panel title={t('sites.danger')} description={t('sites.deleteDescription')}>
      <InlineConfirm
        tone="danger"
        title={t('sites.deleteTitle', { name: site.name })}
        description={t('sites.deleteConsequence')}
        confirmLabel={t('common.delete')}
        onConfirm={remove}
        trigger={<Button variant="destructive-ghost">{t('sites.delete')}</Button>}
      />
    </Panel>
  );
};
