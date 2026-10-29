import type { ApprovalWorkflow, ChangeSet } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { EDITABLE_STATUSES } from '../../Changes/constants';
import { useDevelopPermissions } from '../../Changes/hooks/useDevelopPermissions';
import { Actions } from './Actions';
import { ApprovalBanner } from './Banner';
import { approvalStateOf } from './helpers/approvalState';
import { Signoffs } from './Signoffs';
import { StageStrip } from './StageStrip';

type ApprovalPanelProps = {
  set: ChangeSet;
  /** The site's effective workflow: sets can be sent for approval and need it to ship. Null: approval is off. */
  workflow: ApprovalWorkflow | null;
};

/**
 * The set's approval block (plan approval-workflows): where the review stands, the workflow's stages (frozen on
 * the set once review starts; the site's before), every sign-off, and the steps this admin may take. Hidden
 * on a site without approval for a set that was never sent for it.
 */
export const ApprovalPanel = ({ set, workflow }: ApprovalPanelProps) => {
  const { t } = useTranslation();
  const permissions = useDevelopPermissions();
  const { approval } = set;
  const state = approvalStateOf(set, permissions, workflow !== null);
  const editable = EDITABLE_STATUSES.has(set.status);
  const stripWorkflow = approval.status === 'none' ? (editable ? workflow : null) : approval.workflow;
  if (approval.status === 'none' && approval.signoffs.length === 0 && !stripWorkflow) {
    return null;
  }
  return (
    <Panel title={t('approval.title')} actions={<Actions set={set} state={state} />}>
      <div className="space-y-4">
        <ApprovalBanner set={set} blocked={workflow !== null && editable && !state.current} />
        {stripWorkflow ? <StageStrip workflow={stripWorkflow} approval={approval} /> : null}
        <Signoffs signoffs={approval.signoffs} round={approval.round} />
      </div>
    </Panel>
  );
};
