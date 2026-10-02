import { useNavigate } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRestoreSnapshot } from '@/api/snapshots';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';

type RestoreButtonProps = {
  seq: number;
  size?: 'sm' | 'default';
  /** A visible label that names the place itself ("Restore to here"); otherwise "Restore", named "Restore vN". */
  label?: string;
};

/**
 * Restore: creates a reviewable change set that brings live content back to snapshot `seq` (schema is not
 * rolled back), then opens it. Nothing goes live until that set ships.
 */
export const RestoreButton = ({ seq, size = 'sm', label }: RestoreButtonProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const restore = useRestoreSnapshot();
  return (
    <InlineConfirm
      tone="default"
      title={t('snapshots.restoreTitle', { seq })}
      description={t('snapshots.restoreDescription', { seq })}
      confirmLabel={t('snapshots.restore')}
      pendingLabel={t('common.saving')}
      onConfirm={() =>
        restore.mutateAsync(seq, {
          onSuccess: (set) => void navigate({ to: '/changes/$changeSetId', params: { changeSetId: set.id } }),
        })
      }
      trigger={
        <Button
          variant="outline"
          size={size}
          aria-label={label ? undefined : t('snapshots.restoreLabel', { seq })}
        >
          <RotateCcw aria-hidden="true" />
          {label ?? t('snapshots.restore')}
        </Button>
      }
    />
  );
};
