import type { DefinitionScope } from '@shapio/client';
import type { DefinitionKind } from '@shapio/schema';
import { Link, type LinkOptions } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSwitchField } from '@/components/FormSwitchField';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useCreateDefinitionForm } from '@/features/Models/hooks/useCreateDefinitionForm';
import { useSchemaLock } from '@/features/Models/hooks/useSchemaLock';
import { LockNotice } from '@/features/Models/LockNotice';
import { cn } from '@/helpers/cn';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { EndpointPreview } from '../EndpointPreview';
import { KindPicker } from '../KindPicker';
import { ScopePicker } from '../ScopePicker';

type FormProps = {
  title: string;
  /** The kinds offered; the picker is hidden when there is only one. */
  kinds: readonly [DefinitionKind, ...DefinitionKind[]];
  /** Where Cancel and the breadcrumb go. */
  back: LinkOptions;
  backLabel: string;
  /** Shown above the form (content types: "Describe it", when assist is on). */
  intro?: ReactNode;
  /** A fixed scope hides the "Available on" control (the network view creates shared definitions). */
  scope?: DefinitionScope;
};

/**
 * Creates a content type (collection or single type) or a component, live, then opens it for editing.
 * Shared by `/content/new`, `/develop/components/new` and `/network/content-types/new`. Where there is more
 * than one site, it asks where the definition is available (this site unless "All sites" is chosen).
 */
export const Form = ({ title, kinds, back, backLabel, intro, scope }: FormProps) => {
  const { t } = useTranslation();
  const { locked, reason } = useSchemaLock();
  const { multiSite, canShare } = useSchemaScopeAccess();
  const { form, onSubmit, pending, error } = useCreateDefinitionForm(kinds[0], scope);
  const [kind, apiKey, pluralApiKey] = useWatch({
    control: form.control,
    name: ['kind', 'apiKey', 'pluralApiKey'],
  });
  const isCollection = kind === 'collection';
  return (
    <Page width="narrow">
      <UnsavedChangesGuard when={form.formState.isDirty} />
      <PageHeader breadcrumb={[{ label: backLabel, link: back }]} title={title} />
      {locked ? <LockNotice reason={reason} /> : null}
      {intro}
      <Panel>
        <form noValidate onSubmit={(event) => void onSubmit(event)}>
          <FieldGroup className="gap-5">
            {kinds.length > 1 ? <KindPicker control={form.control} kinds={kinds} /> : null}
            {scope === undefined && multiSite ? (
              <ScopePicker control={form.control} canShare={canShare} />
            ) : null}
            <FormTextField control={form.control} name="label" label={t('models.label')} autoComplete="off" />
            {/* A collection's two API IDs sit side by side, with the names they produce below both. */}
            <div className={cn('grid items-start gap-5', isCollection && 'sm:grid-cols-2')}>
              <FormTextField
                control={form.control}
                name="apiKey"
                label={t('models.apiKey')}
                hint={t('models.apiKeyHint')}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              {isCollection ? (
                <FormTextField
                  control={form.control}
                  name="pluralApiKey"
                  label={t('models.pluralApiKey')}
                  hint={t('models.pluralApiKeyHint')}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              ) : null}
            </div>
            <EndpointPreview apiKey={apiKey} pluralApiKey={pluralApiKey} kind={kind} />
            <FormTextareaField
              control={form.control}
              name="description"
              label={t('common.optionalLabel', { label: t('models.descriptionLabel') })}
              rows={2}
            />
            {kind === 'component' ? null : (
              <FormSwitchField
                control={form.control}
                name="localized"
                label={t('models.localized')}
                hint={t('models.localizedHint')}
                variant="bordered"
              />
            )}
            <FormError error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" asChild>
                <Link {...back}>{t('common.cancel')}</Link>
              </Button>
              <SubmitButton pending={pending} pendingLabel={t('models.creating')} disabled={locked}>
                {t('common.create')}
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </Panel>
    </Page>
  );
};
