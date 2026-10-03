import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { InfoHint } from '@/components/InfoHint';
import { SAVE_BEFORE_ASSIST_KEYS } from '../helpers/assistMessages';
import { useSummarizeIntoField } from '../hooks/useSummarizeIntoField';

type SummarizeActionProps = { field: FieldDefinition };

/** "Summarize from body" under a summarizable property's editor: fills it with a proposal to review. */
export const SummarizeAction = ({ field }: SummarizeActionProps) => {
  const { t } = useTranslation();
  const summarize = useSummarizeIntoField(field);
  if (!summarize.available) {
    return null;
  }
  return (
    <div className="mt-3 space-y-1 border-t pt-3">
      <div className="flex items-center gap-1">
        <AssistButton pending={summarize.pending} pendingLabel={t('assist.working')} onClick={summarize.run}>
          {t('assist.summarize.run')}
        </AssistButton>
        <InfoHint about={t('assist.summarize.run')}>{t('assist.summarize.hint')}</InfoHint>
      </div>
      {summarize.blocked ? (
        <p role="alert" className="text-meta text-destructive">
          {t(SAVE_BEFORE_ASSIST_KEYS[summarize.blocked])}
        </p>
      ) : null}
      <AssistError error={summarize.error} />
      {summarize.truncated ? (
        <p className="text-meta text-muted-foreground">{t('assist.truncated')}</p>
      ) : null}
    </div>
  );
};
