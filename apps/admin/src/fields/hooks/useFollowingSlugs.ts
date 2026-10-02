import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { useEffect } from 'react';
import type { EntryFormStore } from '../form/store';
import { textValue } from '../helpers/props';
import { slugify } from '../helpers/slugify';

type SlugPair = { slug: FieldDefinition; source: FieldDefinition };

const slugPairsOf = (model: ModelDefinition): SlugPair[] =>
  model.fields.flatMap((slug) => {
    if (slug.type !== 'slug' || slug.deprecated || !slug.settings.sourceFieldId) {
      return [];
    }
    const source = model.fields.find((field) => field.id === slug.settings.sourceFieldId);
    return source ? [{ slug, source }] : [];
  });

/**
 * Top-level slugs follow their source field (usually the title) even when their editor isn't on screen: in
 * the entry document a slug is a property, often only in the settings drawer. A slug still follows while
 * it is empty or equal to what the previous source text generated; once edited by hand it stays. (The
 * slug editor does the same while it is shown; both write the same value.)
 */
export const useFollowingSlugs = (store: EntryFormStore, model: ModelDefinition, enabled: boolean) => {
  useEffect(() => {
    const pairs = slugPairsOf(model);
    if (!enabled || pairs.length === 0) {
      return undefined;
    }
    return store.subscribe((state, previous) => {
      for (const { slug, source } of pairs) {
        const before = previous.values[source.apiKey];
        const after = state.values[source.apiKey];
        if (before === after) {
          continue;
        }
        const current = textValue(state.values[slug.apiKey]);
        if (current === '' || current === slugify(textValue(before))) {
          const next = slugify(textValue(after));
          if (next !== current) {
            state.setValue(slug.apiKey, next === '' ? null : next);
          }
        }
      }
    });
  }, [store, model, enabled]);
};
