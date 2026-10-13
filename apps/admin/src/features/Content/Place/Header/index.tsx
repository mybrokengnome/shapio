import type { Locale } from '@shapio/client';
import type { ResolvedModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { LocaleSelect } from '../../LocaleSelect';
import { NewButton } from '../NewButton';

type HeaderProps = {
  model: ResolvedModelDefinition;
  /** Entries in the place; undefined while unknown. */
  count: number | undefined;
  locales: readonly Locale[];
  /** The list's locale; null for models that aren't localized. */
  locale: string | null;
  onLocaleChange: (code: string) => void;
  /** The kinds the admin may create (New, or a menu of them). */
  creatable: readonly ResolvedModelDefinition[];
};

/** A collection's header: its name and entry count, the content locale and New. */
export const Header = ({ model, count, locales, locale, onLocaleChange, creatable }: HeaderProps) => {
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
          <NewButton model={model} kinds={creatable} locale={locale} />
        </>
      }
    />
  );
};
