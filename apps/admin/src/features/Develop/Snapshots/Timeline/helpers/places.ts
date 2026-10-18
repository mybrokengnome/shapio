import { effectiveLayout, effectiveTitleField, routePathOf, type ModelDefinition } from '@shapio/schema';
import type { TimelinePlace } from '@/api/snapshots';

export type PlaceWithLocales = TimelinePlace & { locales: string[] };

/**
 * What the timeline reads of a model: give it the resolved definition, so inherited titles and covers count,
 * and its ancestors (root first), so a kind is read where delivery serves it (`products/digital`).
 */
export const placeOf = (
  model: ModelDefinition,
  ancestors: readonly ModelDefinition[],
  locales: string[],
): PlaceWithLocales => {
  const title = effectiveTitleField(model);
  const cover = effectiveLayout(model).cover;
  return {
    modelId: model.id,
    modelKey: model.apiKey,
    routeKey: routePathOf(model, ancestors),
    label: model.label,
    singleton: model.kind === 'singleton',
    titleKey: title?.apiKey ?? null,
    coverKey: cover?.apiKey ?? null,
    locales,
  };
};
