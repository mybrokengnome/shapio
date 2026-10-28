import type { ApprovalWorkflow } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useAdminRoles } from '../hooks/useAdminRoles';

type WorkflowSummaryProps = { workflow: ApprovalWorkflow };

/** A workflow read-only: each stage with who may sign and how many sign-offs it needs, then the self rule. */
export const WorkflowSummary = ({ workflow }: WorkflowSummaryProps) => {
  const { t, i18n } = useTranslation();
  const { adminRoles } = useAdminRoles();
  const list = new Intl.ListFormat(i18n.language, { type: 'disjunction' });
  const roleName = (id: string) =>
    adminRoles?.find((role) => role.id === id)?.name ??
    (adminRoles ? t('approval.deletedRole') : t('common.loading'));
  return (
    <div className="space-y-3">
      <ol className="space-y-2" aria-label={t('approval.stages')}>
        {workflow.stages.map((stage, index) => (
          <li key={stage.id} className="rounded-lg border px-3 py-2">
            <p className="text-sm font-semibold">
              {t('approval.stageTitle', { number: index + 1, name: stage.name })}
            </p>
            <p className="text-meta text-muted-foreground">
              {[
                stage.roleIds.length > 0
                  ? list.format(stage.roleIds.map(roleName))
                  : t('approval.anyApprover'),
                t('approval.signoffsNeeded', { count: stage.required }),
              ].join(' · ')}
            </p>
          </li>
        ))}
      </ol>
      <p className="text-meta text-muted-foreground">
        {workflow.selfApproval ? t('approval.selfApprovalOn') : t('approval.selfApprovalOff')}
      </p>
    </div>
  );
};
