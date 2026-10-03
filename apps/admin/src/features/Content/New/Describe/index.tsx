import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { HintedLabel } from '@/components/HintedLabel';
import { Panel } from '@/components/Panel';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SCHEMA_DESCRIPTION_MAX } from '@/constants/assist';
import { useSchemaLock } from '@/features/Models/hooks/useSchemaLock';
import { useDescribeSchema } from '../hooks/useDescribeSchema';
import { Proposal } from './Proposal';

/** "Describe it" above the new content type form: a model proposes the types, a change set holds them. */
export const Describe = () => {
  const { t } = useTranslation();
  const id = useId();
  const enabled = useAssistEnabled();
  const { locked } = useSchemaLock();
  const describe = useDescribeSchema();
  if (!enabled) {
    return null;
  }
  return (
    <Panel title={t('assist.describe.title')} titleAs="h2">
      <div className="space-y-3">
        {describe.proposal ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              describe.addToChangeSet();
            }}
          >
            <Proposal proposal={describe.proposal} />
            <AssistError error={describe.addError} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={describe.discard}>
                {t('assist.discard')}
              </Button>
              <SubmitButton pending={describe.adding} pendingLabel={t('common.saving')} disabled={locked}>
                {t('assist.describe.add')}
              </SubmitButton>
            </div>
          </form>
        ) : (
          <>
            <div className="space-y-2">
              <HintedLabel
                htmlFor={`${id}-description`}
                label={t('assist.describe.label')}
                hint={t('assist.describe.hint')}
              />
              <Textarea
                id={`${id}-description`}
                value={describe.description}
                rows={4}
                maxLength={SCHEMA_DESCRIPTION_MAX}
                placeholder={t('assist.describe.placeholder')}
                disabled={describe.proposing}
                onChange={(event) => describe.setDescription(event.target.value)}
              />
            </div>
            <AssistError error={describe.proposeError} />
            <div className="flex justify-end">
              <AssistButton
                variant="outline"
                size="default"
                pending={describe.proposing}
                pendingLabel={t('assist.working')}
                disabled={describe.description.trim() === '' || locked}
                onClick={describe.run}
              >
                {t('assist.describe.run')}
              </AssistButton>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
};
