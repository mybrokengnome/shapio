import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { InfoHint } from '@/components/InfoHint';
import { cn } from '@/helpers/cn';
import { SAVE_BEFORE_ASSIST_KEYS } from '../helpers/assistMessages';
import { useSuggestIntoField } from '../hooks/useSuggestIntoField';

type FieldAssistProps = {
  /** The field's label, for the button's accessible name ("Suggest a value for Excerpt"). */
  label: string;
  /** JSON pointer of the value in API IDs (`/excerpt`, `/seo/title`). */
  path: string;
  onChange: (value: unknown) => void;
  /** `end`: right-aligned under the value (the property grid, component blocks in the canvas). */
  align?: 'start' | 'end';
};

/**
 * "Suggest" under a field that assist can fill (render it only where `useCanSuggest` holds): the model
 * writes a value from the rest of the entry into the field, as an edit to review and save. Renders nothing
 * while assist is off. It appears while the pointer is over the field or focus is inside it (always on touch
 * screens), and stays while it has something to show.
 */
export const FieldAssist = ({ label, path, onChange, align = 'start' }: FieldAssistProps) => {
  const { t } = useTranslation();
  const enabled = useAssistEnabled();
  const suggest = useSuggestIntoField(path, onChange);
  if (!enabled || !suggest.available) {
    return null;
  }
  const name = t('assist.suggest.runFor', { field: label });
  // Something to see (progress, why it didn't run, a shortened value): shown whatever the pointer does.
  const showing = suggest.pending || suggest.blocked !== null || suggest.error !== null || suggest.truncated;
  return (
    <div
      className={cn(
        'space-y-1 transition-opacity',
        // Out of sight until the field is pointed at or focused (the field is a `group/field`); still in the
        // tab order and the accessibility tree, and always shown on touch screens, which have no hover.
        showing
          ? 'opacity-100'
          : 'opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
        align === 'end' && 'flex flex-col items-end',
      )}
    >
      <div className="flex items-center gap-1">
        <AssistButton
          size="xs"
          pending={suggest.pending}
          pendingLabel={t('assist.working')}
          aria-label={suggest.pending ? undefined : name}
          onClick={suggest.run}
        >
          {t('assist.suggest.run')}
        </AssistButton>
        <InfoHint about={name}>{t('assist.suggest.hint')}</InfoHint>
      </div>
      {suggest.blocked ? (
        <p role="alert" className="text-meta text-destructive">
          {t(SAVE_BEFORE_ASSIST_KEYS[suggest.blocked])}
        </p>
      ) : null}
      <AssistError error={suggest.error} />
      {suggest.truncated ? <p className="text-meta text-muted-foreground">{t('assist.truncated')}</p> : null}
    </div>
  );
};
