import type { EntryLocaleState, Locale } from '@shapio/client';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/helpers/cn';
import { ENTRY_STATUS_LABEL_KEYS } from '../helpers/entryStatus';

type LocaleSelectProps = {
  locales: readonly Locale[];
  value: string;
  onChange: (code: string) => void;
  /** Per-locale status of an entry; locales without a version are marked "not created". */
  states?: readonly EntryLocaleState[];
  /** `sm` (36px) in page headers and toolbars, `default` (40px) in panels. */
  size?: 'default' | 'sm';
  id?: string;
  className?: string;
};

/** Chooses the content locale (with each locale's status when editing an entry). */
export const LocaleSelect = ({
  locales,
  value,
  onChange,
  states,
  size,
  id,
  className,
}: LocaleSelectProps) => {
  const { t } = useTranslation();
  const statusOf = (code: string) => {
    if (!states) {
      return undefined;
    }
    const state = states.find((item) => item.locale === code);
    return state ? t(ENTRY_STATUS_LABEL_KEYS[state.status]) : t('content.locales.notCreated');
  };
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        size={size}
        aria-label={id ? undefined : t('content.locales.label')}
        className={cn('w-full', className)}
      >
        <Languages aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((locale) => {
          const status = statusOf(locale.code);
          return (
            <SelectItem key={locale.code} value={locale.code}>
              <span>{locale.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{locale.code}</span>
              {status ? <span className="text-xs text-muted-foreground">· {status}</span> : null}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
