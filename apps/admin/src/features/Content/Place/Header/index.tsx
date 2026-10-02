import type { Locale } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { LocaleSelect } from '../../LocaleSelect';
import { NewButton } from '../NewButton';

type HeaderProps = {
  model: ModelDefinition;
  /** Entries in the place; undefined while unknown. */
  count: number | undefined;
  locales: readonly Locale[];
  /** The list's locale; null for models that aren't localized. */
  locale: string | null;
  onLocaleChange: (code: string) => void;
  canCreate: boolean;
};

/** A collection's header: its name and entry count, the content locale and New. */
export const Header = ({ model, count, locales, locale, onLocaleChange, canCreate }: HeaderProps) => {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={model.label}
      meta={count === undefined ? undefined : t('place.count', { count })}
      actions={
        <>
          {locale ? (
            <LocaleSelect
              locales={locales}
              value={locale}
              size="sm"
              className="w-auto min-w-40"
              onChange={onLocaleChange}
            />
          ) : null}
          {canCreate ? <NewButton modelKey={model.apiKey} locale={locale} /> : null}
        </>
      }
    />
  );
};
