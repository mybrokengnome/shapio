import type { Locale } from '@shapio/client';
import type { ComponentDefinition, ResolvedModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { LocaleSelect } from '../../LocaleSelect';
import { FillIn } from '../FillIn';
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
  /** Components by stable ID (the fields of single components "Fill in…" offers). */
  components: ReadonlyMap<string, ComponentDefinition>;
};

/** A collection's header: its name and entry count, the content locale, "Fill in…" (assist) and New. */
export const Header = ({
  model,
  count,
  locales,
  locale,
  onLocaleChange,
  creatable,
  components,
}: HeaderProps) => {
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
          <FillIn model={model} components={components} locale={locale} />
          <NewButton model={model} kinds={creatable} locale={locale} />
        </>
      }
    />
  );
};
