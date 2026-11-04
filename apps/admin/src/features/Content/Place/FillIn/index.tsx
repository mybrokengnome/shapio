import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { useHasGlobalPermission } from '@/api/auth';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { HintedLabel } from '@/components/HintedLabel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FillResult } from '@/features/Assist/FillResult';
import { fillableFieldsOf } from '@/features/Assist/helpers/fillableFields';
import { useContentOpsProposal } from '@/features/Assist/hooks/useContentOpsProposal';
import { useFieldFill } from '@/features/Assist/hooks/useFieldFill';
import { describeAssistErrorCode } from '@/helpers/describeAssistError';

type FillInProps = {
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  /** The list's locale (null for a type that isn't localized): the run fills that locale. */
  locale: string | null;
};

/**
 * "Fill in…" in a content type's header (assist on, `changes.manage`, a field it can fill): pick a field, and
 * a model proposes a value for every entry where it is empty (in the list's locale). The proposals open in
 * the review sheet; accepted values land as drafts in one change set.
 */
export const FillIn = ({ model, components, locale }: FillInProps) => {
  const { t } = useTranslation();
  const id = useId();
  const enabled = useAssistEnabled();
  const canManageChanges = useHasGlobalPermission('changes.manage');
  const fields = useMemo(() => fillableFieldsOf(model, components), [model, components]);
  const [open, setOpen] = useState(false);
  const [fieldPath, setFieldPath] = useState('');
  const proposal = useContentOpsProposal({ rule: 'fieldEmpty', modelKey: model.apiKey });
  const fill = useFieldFill(proposal.runId);
  if (!enabled || !canManageChanges || fields.length === 0) {
    return null;
  }
  const { run } = proposal;
  const result = run?.status === 'succeeded' ? run.result : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {run && (result?.rule === 'fieldEmpty' || result?.rule === 'requiredEmpty') ? (
        <FillResult model={run.model} result={result} fill={fill} />
      ) : null}
      <AssistError error={proposal.error} />
      {run?.status === 'failed' ? (
        <p role="alert" className="text-meta text-destructive">
          {describeAssistErrorCode(run.error?.code ?? 'INTERNAL_ERROR')}
        </p>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <AssistButton variant="outline" pending={proposal.running} pendingLabel={t('assist.fill.running')}>
            {t('assist.fill.open')}
          </AssistButton>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[min(22rem,calc(100vw-2rem))]"
          aria-label={t('assist.fill.popover')}
        >
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (fieldPath === '') {
                return;
              }
              proposal.propose({ fieldPath, ...(locale ? { locale } : {}) });
              setOpen(false);
            }}
          >
            <div className="space-y-2">
              <HintedLabel
                htmlFor={`${id}-field`}
                label={t('assist.fill.field')}
                hint={t('assist.fill.hint')}
              />
              <Select value={fieldPath} onValueChange={setFieldPath}>
                <SelectTrigger id={`${id}-field`} className="w-full">
                  <SelectValue placeholder={t('assist.fill.fieldPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((field) => (
                    <SelectItem key={field.path} value={field.path}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <AssistButton
                type="submit"
                variant="default"
                pending={proposal.running}
                pendingLabel={t('assist.fill.running')}
                disabled={fieldPath === ''}
              >
                {t('assist.fill.propose')}
              </AssistButton>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
};
