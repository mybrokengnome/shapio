import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFieldsEnvironment } from '@/fields/form/context';
import { proposalKey, useAssistProposalsStore } from '@/stores/assistProposals';

type AssistProposalBannerProps = { labelOf: (code: string) => string };

/**
 * "Proposed by {model}" over a locale draft an assist just wrote (translate): review before publishing.
 * The translation's issues (values cut to a limit, segments left untranslated) are listed by field.
 */
export const AssistProposalBanner = ({ labelOf }: AssistProposalBannerProps) => {
  const { t } = useTranslation();
  const { model, entryId, locale } = useFieldsEnvironment();
  const key = entryId ? proposalKey(model.apiKey, entryId, locale) : '';
  const proposal = useAssistProposalsStore((state) => state.proposals[key]);
  const dismiss = useAssistProposalsStore((state) => state.dismiss);
  if (!proposal) {
    return null;
  }
  const labelOfPath = (path: string) => {
    const apiKey = path.split('/')[1] ?? '';
    return model.fields.find((field) => field.apiKey === apiKey)?.label ?? apiKey;
  };
  return (
    <Alert variant="info" role="status">
      <Sparkles aria-hidden="true" />
      <AlertTitle>{t('assist.proposal.title', { model: proposal.model })}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{t('assist.proposal.description', { from: labelOf(proposal.from) })}</p>
        {proposal.issues.length > 0 ? (
          <ul aria-label={t('assist.proposal.issues')} className="list-disc space-y-0.5 pl-5">
            {proposal.issues.map((issue) => (
              <li key={`${issue.path}:${issue.code}`}>
                <span className="font-semibold">{labelOfPath(issue.path)}</span>: {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => dismiss(key)}>
            {t('assist.proposal.dismiss')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};
