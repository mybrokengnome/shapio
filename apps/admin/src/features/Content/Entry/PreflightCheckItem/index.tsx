import type { PreflightCheck } from '@shapio/client';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import type { SentenceParts } from '../helpers/preflightSentences';

type PreflightCheckItemProps = {
  check: PreflightCheck;
  sentence: SentenceParts;
  /** Takes the person to the value to fix (absent when the check has no place in the document). */
  onFix?: () => void;
};

/** One pre-flight finding as a plain sentence: an error blocks publishing, a warning only informs. */
export const PreflightCheckItem = ({ check, sentence, onFix }: PreflightCheckItemProps) => {
  const { t } = useTranslation();
  const error = check.severity === 'error';
  const Icon = error ? CircleAlert : TriangleAlert;
  return (
    <li className="flex items-start gap-3 border-t py-3 first:border-t-0" data-check-rule={check.rule}>
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', error ? 'text-destructive' : 'text-warning')}
      />
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p>
          <span className="sr-only">
            {error ? t('entry.preflight.error') : t('entry.preflight.warning')}{' '}
          </span>
          {t(sentence.key, sentence.values)}
        </p>
        {error ? null : <p className="text-meta text-muted-foreground">{t('entry.preflight.warningHint')}</p>}
      </div>
      {onFix ? (
        <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0" onClick={onFix}>
          {t('entry.preflight.fix')}
        </Button>
      ) : null}
    </li>
  );
};
