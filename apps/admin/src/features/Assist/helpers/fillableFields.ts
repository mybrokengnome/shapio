import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { isSuggestible } from '@/fields/helpers/assistEligibility';
import { liveFields } from '@/fields/helpers/formValues';

/** A field a fill run can propose values for: its JSON pointer and how to name it ("SEO › Title"). */
export type FillableField = { path: string; label: string };

/**
 * The fields of a content type that "Fill in…" offers: suggestible top-level fields and the suggestible
 * fields of its single (non-repeatable) components, in field order.
 */
export const fillableFieldsOf = (
  model: ModelDefinition,
  components: ReadonlyMap<string, ComponentDefinition>,
): FillableField[] =>
  liveFields(model.fields).flatMap((field): FillableField[] => {
    const path = `/${field.apiKey}`;
    if (isSuggestible(model, field, path)) {
      return [{ path, label: field.label }];
    }
    if (field.type !== 'component' || field.settings.repeatable) {
      return [];
    }
    const component = components.get(field.settings.component);
    return liveFields(component?.fields ?? [])
      .filter((inner) => isSuggestible(model, inner, `${path}/${inner.apiKey}`))
      .map((inner) => ({ path: `${path}/${inner.apiKey}`, label: `${field.label} › ${inner.label}` }));
  });
