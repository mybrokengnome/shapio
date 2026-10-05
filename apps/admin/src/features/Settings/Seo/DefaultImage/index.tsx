import { ImagePlus } from 'lucide-react';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import { HintedLabel } from '@/components/HintedLabel';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { useMediaPickerDialog } from '@/fields/hooks/useMediaPickerDialog';
import { AssetTile } from '@/fields/MediaField/AssetTile';
import { describedBy } from '@/helpers/describedBy';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import type { SeoSettingsValues } from '../helpers';

type DefaultImageProps = {
  control: Control<SeoSettingsValues>;
  /** The chosen asset is private: delivery would never show it. */
  imagePrivate: boolean;
};

const BUTTON_ID = 'seo-default-image';
const HINT_ID = `${BUTTON_ID}-hint`;
const ERROR_ID = `${BUTTON_ID}-error`;

/** The site's default social image: one public image from the library, chosen in the media sheet. */
export const DefaultImage = ({ control, imagePrivate }: DefaultImageProps) => {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ control, name: 'imageId' });
  // A private choice is caught here; anything else the server refuses (SEO_IMAGE_INVALID) arrives as an error.
  const error = imagePrivate ? t('seo.settings.imagePrivate') : fieldState.error?.message;
  const { canWrite } = useMediaPermissions();
  const picker = useMediaPickerDialog();
  const choose = async () => {
    const picked = await picker.pickMedia({ multiple: false, allowedKinds: ['image'] });
    const first = picked?.[0];
    if (first) {
      field.onChange(first.id);
    }
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <HintedLabel
        htmlFor={BUTTON_ID}
        label={t('seo.settings.image')}
        hint={t('seo.settings.imageHint')}
        hintId={HINT_ID}
      />
      {field.value ? (
        <ul>
          <AssetTile
            assetId={field.value}
            inputId={BUTTON_ID}
            index={0}
            count={1}
            editable
            canEditAlt={canWrite}
            onRemove={() => field.onChange(null)}
          />
        </ul>
      ) : null}
      <div>
        <Button
          id={BUTTON_ID}
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={describedBy(HINT_ID, error ? ERROR_ID : undefined)}
          onClick={() => void choose()}
        >
          <ImagePlus aria-hidden="true" />
          {field.value ? t('seo.settings.changeImage') : t('seo.settings.chooseImage')}
        </Button>
      </div>
      <FormFieldError id={error ? ERROR_ID : undefined} message={error} />
      {picker.dialog}
    </Field>
  );
};
