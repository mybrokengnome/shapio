import { effectiveLayout, effectiveTitleField, routeKeyOf, type ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useLocales } from '@/api/locales';
import { useDefinitions } from '@/api/schema';
import type { TimelinePlace } from '@/api/snapshots';

export type PlaceWithLocales = TimelinePlace & { locales: string[] };

const placeOf = (model: ModelDefinition, locales: string[]): PlaceWithLocales => {
  const title = effectiveTitleField(model);
  const cover = effectiveLayout(model).cover;
  return {
    modelId: model.id,
    modelKey: model.apiKey,
    routeKey: routeKeyOf(model),
    label: model.label,
    singleton: model.kind === 'singleton',
    titleKey: title?.apiKey ?? null,
    coverKey: cover?.apiKey ?? null,
    locales,
  };
};

/**
 * The places the timeline reads, with the locales to read each in: every locale for localized models
 * (delivery reports the locale it actually served, so fallbacks merge), the default one otherwise.
 */
export const useTimelinePlaces = () => {
  const models = useDefinitions('model');
  const locales = useLocales();
  const places = useMemo(() => {
    if (!models.data || !locales.data) {
      return undefined;
    }
    const codes = locales.data.map((locale) => locale.code);
    const defaultLocale = locales.data.find((locale) => locale.isDefault)?.code ?? codes[0] ?? 'en';
    return models.data.flatMap(({ definition }) =>
      definition.kind === 'component'
        ? []
        : [placeOf(definition, definition.localized ? codes : [defaultLocale])],
    );
  }, [models.data, locales.data]);
  return { places, error: models.error ?? locales.error };
};
