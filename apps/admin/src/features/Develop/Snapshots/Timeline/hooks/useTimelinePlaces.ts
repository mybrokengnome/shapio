import { useMemo } from 'react';
import { useLocales } from '@/api/locales';
import { useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';
import { placeOf } from '../helpers/places';

/**
 * The places the timeline reads, with the locales to read each in: every locale for localized models
 * (delivery reports the locale it actually served, so fallbacks merge), the default one otherwise. Models are
 * resolved, so a kind's title and cover may be inherited (plan polymorphic-types).
 */
export const useTimelinePlaces = () => {
  const { resolved, error } = useResolvedDefinitions();
  const locales = useLocales();
  const places = useMemo(() => {
    if (!resolved || !locales.data) {
      return undefined;
    }
    const codes = locales.data.map((locale) => locale.code);
    const defaultLocale = locales.data.find((locale) => locale.isDefault)?.code ?? codes[0] ?? 'en';
    return resolved.definitions.flatMap(({ definition }) => {
      const model = resolved.byId.get(definition.id);
      if (!model) {
        return [];
      }
      const ancestors = model.ancestorIds.flatMap((id) => resolved.byId.get(id) ?? []);
      return [placeOf(model, ancestors, model.localized ? codes : [defaultLocale])];
    });
  }, [resolved, locales.data]);
  return { places, error: error ?? locales.error };
};
