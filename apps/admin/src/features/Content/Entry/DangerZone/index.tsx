import { Copy, Trash2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import { DrawerSection } from '../DrawerSection';

type DangerZoneProps = {
  title: string;
  /** Present while this locale is live. */
  onUnpublish?: () => Promise<unknown>;
  onDuplicate?: () => void;
  onDelete?: () => Promise<unknown>;
};

/** Taking the entry offline, copying it, deleting it: each consequential one confirmed in place. */
export const DangerZone = ({ title, onUnpublish, onDuplicate, onDelete }: DangerZoneProps) => {
  const { t } = useTranslation();
  if (!onUnpublish && !onDuplicate && !onDelete) {
    return null;
  }
  return (
    <DrawerSection id="entry-settings-danger" title={t('entry.settings.danger')}>
      <div className="flex flex-wrap gap-2">
        {onUnpublish ? (
          <InlineConfirm
            tone="default"
            align="start"
            title={t('entry.settings.unpublishTitle')}
            description={t('entry.settings.unpublishDescription')}
            confirmLabel={t('content.actions.unpublish')}
            onConfirm={onUnpublish}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Undo2 aria-hidden="true" />
                {t('content.actions.unpublish')}
              </Button>
            }
          />
        ) : null}
        {onDuplicate ? (
          <Button type="button" variant="outline" size="sm" onClick={onDuplicate}>
            <Copy aria-hidden="true" />
            {t('content.actions.duplicate')}
          </Button>
        ) : null}
        {onDelete ? (
          <InlineConfirm
            tone="danger"
            align="start"
            title={t('content.form.deleteTitle', { title })}
            description={t('content.form.deleteDescription')}
            confirmLabel={t('common.delete')}
            onConfirm={onDelete}
            trigger={
              <Button type="button" variant="destructive-ghost" size="sm">
                <Trash2 aria-hidden="true" />
                {t('content.actions.delete')}
              </Button>
            }
          />
        ) : null}
      </div>
    </DrawerSection>
  );
};
