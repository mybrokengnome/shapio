import type { Locale } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { cn } from '@/helpers/cn';
import { SAVE_BEFORE_ASSIST_KEYS } from '../helpers/assistMessages';
import type { SaveBeforeAssist } from '../hooks/useAssistTarget';
import { useTranslateLocale } from '../hooks/useTranslateLocale';

type TranslateLocaleProps = {
  model: ModelDefinition;
  entryId: string;
  /** The locale to translate from, and its label. */
  from: string;
  fromLabel: string;
  /** Locales this entry doesn't have yet. */
  targets: readonly Pick<Locale, 'code' | 'label'>[];
  /** Saves the open document first when it is `from`. */
  prepare?: () => Promise<SaveBeforeAssist>;
  onOpen: (locale: string) => void;
  className?: string;
};

/** "Translate {locale} from {from}" for each locale not started: a draft to review, opened with a banner. */
export const TranslateLocale = ({
  model,
  entryId,
  from,
  fromLabel,
  targets,
  prepare,
  onOpen,
  className,
}: TranslateLocaleProps) => {
  const { t } = useTranslation();
  const enabled = useAssistEnabled();
  const translate = useTranslateLocale({ model, entryId, prepare, onOpen });
  if (!enabled || targets.length === 0) {
    return null;
  }
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex flex-wrap gap-1">
        {targets.map((locale) => (
          <AssistButton
            key={locale.code}
            pending={translate.pending && translate.target === locale.code}
            pendingLabel={t('assist.translate.pending', { locale: locale.label })}
            disabled={translate.pending}
            onClick={() => translate.run(from, locale.code)}
          >
            {t('assist.translate.run', { locale: locale.label, from: fromLabel })}
          </AssistButton>
        ))}
      </div>
      {translate.blocked ? (
        <p role="alert" className="text-meta text-destructive">
          {t(SAVE_BEFORE_ASSIST_KEYS[translate.blocked])}
        </p>
      ) : null}
      <AssistError error={translate.error} />
    </div>
  );
};
