import { effectiveLayout, effectiveTitleField, routeKeyOf, type ModelDefinition } from '@shapio/schema';
import type { TimelinePlace } from '@/api/snapshots';

export type PlaceWithLocales = TimelinePlace & { locales: string[] };

/** What the timeline reads of a model: give it the resolved definition, so inherited titles and covers count. */
export const placeOf = (model: ModelDefinition, locales: string[]): PlaceWithLocales => {
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
