import type { AdminEntry, MediaAsset } from '@shapio/client';
import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { defaultFormValues, liveFields, toFormValues } from '@/fields/helpers/formValues';
import type { FormValues } from '@/fields/helpers/values';

type Collect = (asset: MediaAsset) => void;

/**
 * Values for a locale that has no version of the entry yet: shared fields come from an existing locale
 * (they are the same in every locale, ADR 0004), localized fields start from their defaults.
 */
export const newLocaleValues = (
  model: ModelDefinition,
  source: AdminEntry,
  components: ReadonlyMap<string, ComponentDefinition>,
  collect: Collect,
): FormValues => {
  const fromSource = toFormValues(model.fields, source.data, components, collect);
  const defaults = defaultFormValues(model.fields);
  return Object.fromEntries(
    liveFields(model.fields).map((field) => [
      field.apiKey,
      field.localized ? defaults[field.apiKey] : fromSource[field.apiKey],
    ]),
  );
};

/** Localized fields' values of another locale (for "copy from the default locale"). */
export const localizedValuesOf = (
  model: ModelDefinition,
  source: AdminEntry,
  components: ReadonlyMap<string, ComponentDefinition>,
  collect: Collect,
): FormValues => {
  const values = toFormValues(model.fields, source.data, components, collect);
  return Object.fromEntries(
    liveFields(model.fields)
      .filter((field) => field.localized)
      .map((field) => [field.apiKey, values[field.apiKey]]),
  );
};
