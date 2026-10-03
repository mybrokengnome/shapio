import type { Site } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { HintedLabel } from '@/components/HintedLabel';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useRenameSiteForm } from '../hooks/useRenameSiteForm';

type DetailsProps = { site: Site; canManage: boolean };

const KEY_ID = 'site-key';
const KEY_HINT_ID = 'site-key-hint';

/** The site's name (renamed with `sites.manage`) and its fixed key. */
export const Details = ({ site, canManage }: DetailsProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, updateSite } = useRenameSiteForm(site);
  const { isDirty } = form.formState;
  return (
    <Panel title={t('sites.details')}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="max-w-md">
        <FieldGroup>
          <FormTextField
            control={form.control}
            name="name"
            label={t('sites.name')}
            autoComplete="off"
            readOnly={!canManage}
          />
          <Field>
            <HintedLabel
              htmlFor={KEY_ID}
              label={t('sites.key')}
              hint={t('sites.keyHint')}
              hintId={KEY_HINT_ID}
            />
            <Input
              id={KEY_ID}
              value={site.key}
              readOnly
              className="font-mono"
              aria-describedby={KEY_HINT_ID}
            />
          </Field>
          <FormError error={updateSite.error} />
          {canManage ? (
            <div>
              <SubmitButton
                pending={updateSite.isPending}
                pendingLabel={t('common.saving')}
                disabled={!isDirty}
              >
                {t('common.saveChanges')}
              </SubmitButton>
            </div>
          ) : null}
        </FieldGroup>
      </form>
      <UnsavedChangesGuard when={isDirty} />
    </Panel>
  );
};
