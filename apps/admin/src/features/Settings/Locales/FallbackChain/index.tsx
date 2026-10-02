import type { Locale } from '@shapio/client';
import { MAX_FALLBACK_CHAIN } from '@shapio/schema';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import { useController, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LocaleValues } from '../hooks/useLocaleForm';

const LEGEND_ID = 'locale-fallbacks-legend';

type FallbackChainProps = {
  control: Control<LocaleValues>;
  /** Every configured locale; the one being edited is excluded from the choices. */
  locales: readonly Locale[];
  code: string;
};

/** The ordered locales delivery tries when content is missing in this one (the default is always last). */
export const FallbackChain = ({ control, locales, code }: FallbackChainProps) => {
  const { t } = useTranslation();
  const { field, fieldState } = useController({ control, name: 'fallbacks' });
  const [adding, setAdding] = useState('');
  const chain = field.value;
  const labelOf = (value: string) => locales.find((locale) => locale.code === value)?.label ?? value;
  const available = locales.filter((locale) => locale.code !== code && !chain.includes(locale.code));
  const move = (from: number, to: number) => {
    const next = [...chain];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as string);
    field.onChange(next);
  };
  return (
    <FieldSet className="gap-3" aria-labelledby={LEGEND_ID}>
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1">
        <span id={LEGEND_ID}>{t('locales.fallbacks')}</span>
        <InfoHint about={t('locales.fallbacks')}>{t('locales.fallbacksHint')}</InfoHint>
      </FieldLegend>
      {chain.length > 0 ? (
        <ol className="space-y-1">
          {chain.map((value, index) => (
            <li key={value} className="flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3 text-sm">
              <span className="w-5 text-muted-foreground">{index + 1}.</span>
              <span className="flex-1">
                {labelOf(value)} <span className="font-mono text-xs text-muted-foreground">{value}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('locales.moveUp', { locale: labelOf(value) })}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('locales.moveDown', { locale: labelOf(value) })}
                disabled={index === chain.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('locales.removeFallback', { locale: labelOf(value) })}
                onClick={() => field.onChange(chain.filter((entry) => entry !== value))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t('locales.noFallbacks')}</p>
      )}
      {available.length > 0 && chain.length < MAX_FALLBACK_CHAIN ? (
        <Select
          value={adding}
          onValueChange={(value) => {
            field.onChange([...chain, value]);
            setAdding('');
          }}
        >
          <SelectTrigger className="w-full sm:w-64" aria-label={t('locales.addFallback')}>
            <SelectValue placeholder={t('locales.addFallback')} />
          </SelectTrigger>
          <SelectContent>
            {available.map((locale) => (
              <SelectItem key={locale.code} value={locale.code}>
                {locale.label} ({locale.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <FormFieldError message={fieldState.error?.message} />
    </FieldSet>
  );
};
