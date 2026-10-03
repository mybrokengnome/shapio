import type { MediaAsset } from '@shapio/client';
import { useController, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FocalPoint } from '@/components/FocalPoint';
import { FormError } from '@/components/FormError';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { SuggestAltButton } from '@/components/SuggestAltButton';
import { FieldGroup } from '@/components/ui/field';
import { isImage } from '../../helpers/fileKind';
import type { AssetDetailsValues } from '../../hooks/useAssetDetailsForm';

type MetadataFormProps = {
  asset: MediaAsset;
  form: UseFormReturn<AssetDetailsValues>;
  onSubmit: () => void;
  pending: boolean;
  error: unknown;
  readOnly: boolean;
};

/** File name, alt text, caption and (images) focal point; saved together. */
export const MetadataForm = ({ asset, form, onSubmit, pending, error, readOnly }: MetadataFormProps) => {
  const { t } = useTranslation();
  const focal = useController({ control: form.control, name: 'focalPoint' });
  const image = isImage(asset.mimeType);
  return (
    <form
      noValidate
      aria-label={t('media.details.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={readOnly} className="contents">
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="filename"
            label={t('media.fields.filename')}
            autoComplete="off"
          />
          {image ? (
            <FormTextareaField
              control={form.control}
              name="alt"
              label={t('media.fields.alt')}
              rows={2}
              placeholder={t('media.details.altHint')}
            />
          ) : null}
          {image && !readOnly ? (
            <SuggestAltButton
              assetId={asset.id}
              mimeType={asset.mimeType}
              onSuggest={(alt) => form.setValue('alt', alt, { shouldDirty: true, shouldValidate: true })}
            />
          ) : null}
          <FormTextareaField
            control={form.control}
            name="caption"
            label={t('media.fields.caption')}
            rows={2}
          />
          {image && !readOnly ? (
            <FocalPoint
              imageUrl={asset.url}
              value={focal.field.value}
              onChange={(value) => focal.field.onChange(value)}
            />
          ) : null}
          <FormError error={error} />
          {readOnly ? null : (
            <div className="flex justify-end">
              <SubmitButton
                pending={pending}
                pendingLabel={t('common.saving')}
                disabled={!form.formState.isDirty}
              >
                {t('common.saveChanges')}
              </SubmitButton>
            </div>
          )}
        </FieldGroup>
      </fieldset>
    </form>
  );
};
