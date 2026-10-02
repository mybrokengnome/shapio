import type { ModelDefinition } from '@shapio/schema';
import { useLocales } from '@/api/locales';

/** The instance's locales, the default one, and the locale a screen edits (null for non-localized models). */
export const useContentLocales = (model: ModelDefinition | undefined, requested: string | undefined) => {
  const locales = useLocales();
  const list = locales.data ?? [];
  const defaultLocale = list.find((locale) => locale.isDefault)?.code;
  const known = requested && list.some((locale) => locale.code === requested) ? requested : undefined;
  const current = model?.localized ? (known ?? defaultLocale ?? null) : null;
  const labelOf = (code: string) => list.find((locale) => locale.code === code)?.label ?? code;
  return {
    locales: list,
    defaultLocale,
    current,
    labelOf,
    isPending: locales.isPending,
    error: locales.error,
  };
};
