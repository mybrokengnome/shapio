import type { ResolvedModelDefinition } from '@shapio/schema';
import type { ModelRoute } from '../content/model.js';
import { toHookModel } from './hooks.js';
import type { ServiceField, ServiceModel } from './public.js';

/**
 * `content.models()`'s view of one model (ADR 0009, ADR 0012): the hook model plus its effective fields,
 * inherited ones first with the declaring model's API ID, and its delivery route key. `apiKeyOf` names a model
 * by stable ID in the same schema view.
 */
export const toServiceModel = (
  resolved: ResolvedModelDefinition,
  route: ModelRoute,
  apiKeyOf: (id: string) => string | undefined,
): ServiceModel => ({
  ...toHookModel(resolved, route.ancestors.at(-1)),
  routeKey: route.key,
  fields: resolved.fields.map((field): ServiceField => ({
    id: field.id,
    apiKey: field.apiKey,
    label: field.label,
    type: field.type,
    required: field.required,
    localized: field.localized,
    ...(field.inheritedFrom === undefined
      ? {}
      : { inheritedFrom: apiKeyOf(field.inheritedFrom) ?? field.inheritedFrom }),
  })),
});
