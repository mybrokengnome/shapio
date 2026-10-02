import type { MediaAsset } from '@shapio/client';
import { Globe, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateMediaAsset } from '@/api/media';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

type VisibilityProps = { asset: MediaAsset; canManage: boolean };

/**
 * Public files have a stable URL anyone can open; private files only open through signed links that
 * expire. One line says what the current setting means. Changing it needs `media.manage` and is confirmed
 * beside the switch, because it changes who can see the file.
 */
export const Visibility = ({ asset, canManage }: VisibilityProps) => {
  const { t } = useTranslation();
  const update = useUpdateMediaAsset();
  const [confirming, setConfirming] = useState(false);
  const isPrivate = asset.visibility === 'private';
  const next = isPrivate ? 'public' : 'private';
  const consequence = isPrivate
    ? t('media.visibility.privateExplanation')
    : t('media.visibility.publicExplanation');
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <div className="flex items-center gap-1.5">
          {isPrivate ? (
            <Lock aria-hidden="true" className="size-4 text-muted-foreground" />
          ) : (
            <Globe aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
          <FieldLabel htmlFor="asset-private">{t('media.visibility.privateLabel')}</FieldLabel>
        </div>
        <FieldDescription id="asset-private-description">
          {canManage ? consequence : `${consequence} ${t('media.visibility.needsManage')}`}
        </FieldDescription>
      </FieldContent>
      <InlineConfirm
        tone={next === 'public' ? 'danger' : 'default'}
        open={confirming}
        onOpenChange={setConfirming}
        title={
          next === 'private' ? t('media.visibility.makePrivateTitle') : t('media.visibility.makePublicTitle')
        }
        description={
          next === 'private'
            ? t('media.visibility.makePrivateDescription')
            : t('media.visibility.makePublicDescription')
        }
        confirmLabel={
          next === 'private' ? t('media.visibility.makePrivate') : t('media.visibility.makePublic')
        }
        onConfirm={() =>
          update
            .mutateAsync({ id: asset.id, input: { expectedVersion: asset.version, visibility: next } })
            .then(() => toast.success(t('media.visibility.changed')))
        }
      >
        <Switch
          id="asset-private"
          checked={isPrivate}
          disabled={!canManage || update.isPending}
          aria-describedby="asset-private-description"
          onCheckedChange={() => setConfirming(true)}
        />
      </InlineConfirm>
    </Field>
  );
};
