import type { FieldDefinition } from '@shapio/schema';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaAsset, useUpdateMediaAsset } from '@/api/media';
import { FocalPoint } from '@/components/FocalPoint';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldsEnvironment } from '@/fields/form/context';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { DrawerSection } from '../DrawerSection';

type CoverSettingsProps = { field: FieldDefinition };

/**
 * The cover's alt text and focal point. Both belong to the file in the library (shared by every use), so
 * they save to the asset at once, not with the entry.
 */
export const CoverSettings = ({ field }: CoverSettingsProps) => {
  const { t } = useTranslation();
  const altId = useId();
  const { readOnly } = useFieldsEnvironment();
  const { canWrite } = useMediaPermissions();
  const { value } = useTopLevelValue(field);
  const asset = useMediaAsset(typeof value === 'string' ? value : undefined);
  const update = useUpdateMediaAsset();
  const [alt, setAlt] = useState<string | undefined>();
  if (!asset.data) {
    return null;
  }
  const current = asset.data;
  const editable = canWrite && !readOnly;
  return (
    <DrawerSection id="entry-settings-cover" title={t('entry.settings.cover', { field: field.label })}>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (alt !== undefined) {
            update.mutate(
              { id: current.id, input: { expectedVersion: current.version, alt } },
              { onSuccess: () => setAlt(undefined) },
            );
          }
        }}
      >
        <Label htmlFor={altId}>{t('content.media.altLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id={altId}
            value={alt ?? current.alt}
            readOnly={!editable}
            placeholder={t('content.richText.altPlaceholder')}
            aria-describedby={`${altId}-hint`}
            onChange={(event) => setAlt(event.target.value)}
          />
          {editable ? (
            <SubmitButton
              size="default"
              pending={update.isPending}
              pendingLabel={t('common.saving')}
              disabled={alt === undefined || alt === current.alt}
            >
              {t('content.form.save')}
            </SubmitButton>
          ) : null}
        </div>
        <p id={`${altId}-hint`} className="text-meta text-muted-foreground">
          {t('content.media.altHint')}
        </p>
      </form>
      {editable && current.mimeType.startsWith('image/') ? (
        <FocalPoint
          imageUrl={current.url}
          value={current.focalPoint}
          onChange={(focalPoint) =>
            update.mutate({ id: current.id, input: { expectedVersion: current.version, focalPoint } })
          }
        />
      ) : null}
      <FormError error={update.error} />
    </DrawerSection>
  );
};
