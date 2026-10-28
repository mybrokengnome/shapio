import { useTranslation } from 'react-i18next';
import { useSiteChangeSets, type SiteChangeSets } from '@/api/siteChangeSets';
import { FormSwitchField } from '@/components/FormSwitchField';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SubmitButton } from '@/components/SubmitButton';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useChangeSetSettingsForm } from './hooks/useChangeSetSettingsForm';

type ChangeSetSettingsFormProps = { settings: SiteChangeSets };

const ChangeSetSettingsForm = ({ settings }: ChangeSetSettingsFormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, pending } = useChangeSetSettingsForm(settings);
  const { isDirty } = form.formState;
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-6">
      <UnsavedChangesGuard when={isDirty} />
      <Panel title={t('siteChangeSets.changeSetsTitle')} titleAs="h2">
        <FormSwitchField
          control={form.control}
          name="requireApproval"
          variant="bordered"
          label={t('siteChangeSets.requireApproval')}
          hint={t('siteChangeSets.requireApprovalHint')}
        />
      </Panel>
      <div>
        <SubmitButton pending={pending} pendingLabel={t('common.saving')} disabled={!isDirty}>
          {t('common.saveChanges')}
        </SubmitButton>
      </div>
    </form>
  );
};

/** Settings → Change sets: the current site's change set rules (`site.settings`). */
export const ChangeSets = () => {
  const { t } = useTranslation();
  const settings = useSiteChangeSets();
  return (
    <Page width="narrow">
      <PageHeader title={t('settings.changeSets')} />
      <QueryView query={settings} loadingRows={2}>
        {(data) => <ChangeSetSettingsForm key={data.version} settings={data} />}
      </QueryView>
    </Page>
  );
};
