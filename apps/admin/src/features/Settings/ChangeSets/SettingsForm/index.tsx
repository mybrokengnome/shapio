import type { SiteChangeSets } from '@shapio/client';
import { CircleOff, Globe2, ListChecks } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { ModeField, type ModeOption } from '@/features/Approval/ModeField';
import { WorkflowEditor } from '@/features/Approval/WorkflowEditor';
import { WorkflowSummary } from '@/features/Approval/WorkflowSummary';
import { useChangeSetSettingsForm } from '../hooks/useChangeSetSettingsForm';

type SettingsFormProps = {
  settings: SiteChangeSets;
  /** `site.settings`: without it the page is read-only. */
  canEdit: boolean;
};

/**
 * The site's approval: inherit the network default (shown read-only, or off when the network has none), off,
 * or a workflow of its own edited in place.
 */
export const SettingsForm = ({ settings, canEdit }: SettingsFormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, pending } = useChangeSetSettingsForm(settings);
  const mode = useWatch({ control: form.control, name: 'mode' });
  const { isDirty } = form.formState;
  const options: ModeOption[] = [
    {
      value: 'inherit',
      label: t('approval.modes.inherit'),
      description: t('approval.site.inheritDescription'),
      icon: Globe2,
    },
    {
      value: 'off',
      label: t('approval.modes.off'),
      description: t('approval.site.offDescription'),
      icon: CircleOff,
    },
    {
      value: 'custom',
      label: t('approval.modes.custom'),
      description: t('approval.site.customDescription'),
      icon: ListChecks,
    },
  ];
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-6">
      <UnsavedChangesGuard when={isDirty} />
      <Panel
        title={t('approval.title')}
        titleAs="h2"
        description={canEdit ? undefined : t('approval.site.readOnly')}
      >
        <div className="space-y-5">
          <ModeField
            control={form.control}
            label={t('approval.title')}
            options={options}
            disabled={!canEdit}
          />
          {mode === 'inherit' ? (
            settings.inherited ? (
              <WorkflowSummary workflow={settings.inherited} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('approval.site.inheritedOff')}</p>
            )
          ) : null}
          {mode === 'custom' ? (
            canEdit ? (
              <WorkflowEditor control={form.control} />
            ) : settings.workflow ? (
              <WorkflowSummary workflow={settings.workflow} />
            ) : null
          ) : null}
        </div>
      </Panel>
      {canEdit ? (
        <div>
          <SubmitButton pending={pending} pendingLabel={t('common.saving')} disabled={!isDirty}>
            {t('common.saveChanges')}
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
};
