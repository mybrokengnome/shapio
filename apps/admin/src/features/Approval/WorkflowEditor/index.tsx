import { Plus } from 'lucide-react';
import { useFieldArray, useFormState, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import { FormSwitchField } from '@/components/FormSwitchField';
import { Button } from '@/components/ui/button';
import { APPROVAL_LIMITS, newStage, type ApprovalSettingsValues } from '../helpers/workflowForm';
import { useAdminRoles } from '../hooks/useAdminRoles';
import { Stage } from './Stage';

type WorkflowEditorProps = {
  control: Control<ApprovalSettingsValues>;
  disabled?: boolean;
};

/**
 * An approval workflow (plan approval-workflows): its stages in order (each moved, removed, and edited in
 * place; at least one, at most ten) and whether people may approve their own change sets. Used by Network →
 * Approval and Settings → Change sets.
 */
export const WorkflowEditor = ({ control, disabled = false }: WorkflowEditorProps) => {
  const { t } = useTranslation();
  const { adminRoles } = useAdminRoles();
  const { fields, append, move, remove } = useFieldArray({ control, name: 'workflow.stages' });
  const { errors } = useFormState({ control, name: 'workflow.stages' });
  const stagesError = errors.workflow?.stages;
  return (
    <div className="space-y-5">
      <ol className="space-y-3" aria-label={t('approval.stages')}>
        {fields.map((field, index) => (
          <Stage
            key={field.id}
            control={control}
            index={index}
            count={fields.length}
            adminRoles={adminRoles}
            disabled={disabled}
            onMove={move}
            onRemove={remove}
          />
        ))}
      </ol>
      <FormFieldError message={stagesError?.root?.message ?? stagesError?.message} />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || fields.length >= APPROVAL_LIMITS.stages}
          onClick={() => append(newStage())}
        >
          <Plus aria-hidden="true" />
          {t('approval.addStage')}
        </Button>
      </div>
      <FormSwitchField
        control={control}
        name="workflow.selfApproval"
        variant="bordered"
        label={t('approval.selfApproval')}
        hint={t('approval.selfApprovalHint')}
        disabled={disabled}
      />
    </div>
  );
};
