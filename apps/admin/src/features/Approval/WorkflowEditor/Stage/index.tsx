import type { Role } from '@shapio/client';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useId } from 'react';
import { useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import { FormTextField } from '@/components/FormTextField';
import { Button } from '@/components/ui/button';
import { APPROVAL_LIMITS, type ApprovalSettingsValues } from '../../helpers/workflowForm';

type StageProps = {
  control: Control<ApprovalSettingsValues>;
  index: number;
  count: number;
  /** Undefined while the roles load. */
  adminRoles: readonly Role[] | undefined;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
};

/**
 * One stage of a workflow: its name, how many sign-offs it needs, and the roles that may sign (none: anyone who
 * may approve). A checked role that no longer exists stays listed as a deleted role, so it can be unchecked.
 */
export const Stage = ({ control, index, count, adminRoles, disabled, onMove, onRemove }: StageProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  const roleIds = useWatch({ control, name: `workflow.stages.${index}.roleIds` });
  const name = useWatch({ control, name: `workflow.stages.${index}.name` });
  const number = index + 1;
  const label = name.trim() || t('approval.stageNumber', { number });
  const known = new Set(adminRoles?.map((role) => role.id));
  const options = [
    ...(adminRoles ?? []).map((role) => ({ value: role.id, label: role.name })),
    ...(adminRoles
      ? roleIds.filter((id) => !known.has(id)).map((id) => ({ value: id, label: t('approval.deletedRole') }))
      : []),
  ];
  return (
    <li className="rounded-lg border p-4">
      <div role="group" aria-labelledby={headingId} className="space-y-4">
        <div className="flex items-center gap-1">
          <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t('approval.stageNumber', { number })}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('approval.moveUp', { stage: label })}
            disabled={disabled || index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('approval.moveDown', { stage: label })}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('approval.removeStage', { stage: label })}
            disabled={disabled || count === 1}
            onClick={() => onRemove(index)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <FormTextField
            control={control}
            name={`workflow.stages.${index}.name`}
            label={t('approval.stageName')}
            maxLength={APPROVAL_LIMITS.stageName}
            autoComplete="off"
            disabled={disabled}
          />
          <FormTextField
            control={control}
            name={`workflow.stages.${index}.required`}
            label={t('approval.required')}
            type="number"
            inputMode="numeric"
            min={1}
            max={APPROVAL_LIMITS.required}
            disabled={disabled}
          />
        </div>
        <FormCheckboxGroup
          control={control}
          name={`workflow.stages.${index}.roleIds`}
          legend={t('approval.whoMaySign')}
          description={roleIds.length === 0 ? t('approval.anyApprover') : undefined}
          options={options}
          disabled={disabled}
        />
      </div>
    </li>
  );
};
