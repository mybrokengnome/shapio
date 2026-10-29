import type { NetworkApproval } from '@shapio/client';
import { CircleOff, ListChecks } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { ModeField, type ModeOption } from '@/features/Approval/ModeField';
import { WorkflowEditor } from '@/features/Approval/WorkflowEditor';
import { useNetworkApprovalForm } from '../hooks/useNetworkApprovalForm';
import { SiteList } from '../SiteList';

type DefaultFormProps = { approval: NetworkApproval };

/** The default every site inherits: off, or a workflow edited in place; and which sites follow it. */
export const DefaultForm = ({ approval }: DefaultFormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, pending } = useNetworkApprovalForm(approval);
  const mode = useWatch({ control: form.control, name: 'mode' });
  const { isDirty } = form.formState;
  const options: ModeOption[] = [
    {
      value: 'off',
      label: t('approval.modes.off'),
      description: t('approval.network.offDescription'),
      icon: CircleOff,
    },
    {
      value: 'custom',
      label: t('approval.modes.workflow'),
      description: t('approval.network.workflowDescription'),
      icon: ListChecks,
    },
  ];
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-6">
      <UnsavedChangesGuard when={isDirty} />
      <Panel
        title={t('approval.network.defaultTitle')}
        description={t('approval.network.defaultDescription')}
      >
        <div className="space-y-5">
          <ModeField control={form.control} label={t('approval.network.defaultTitle')} options={options} />
          {mode === 'custom' ? <WorkflowEditor control={form.control} /> : null}
          <SiteList sites={approval.sites} />
        </div>
      </Panel>
      <div>
        <SubmitButton pending={pending} pendingLabel={t('common.saving')} disabled={!isDirty}>
          {t('common.saveChanges')}
        </SubmitButton>
      </div>
    </form>
  );
};
