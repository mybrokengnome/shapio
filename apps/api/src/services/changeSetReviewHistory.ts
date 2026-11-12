import {
  classifyChanges,
  diffDefinitions,
  lensEffectOfChange,
  LENS_EFFECTS,
  type ClassifiedChange,
  type LensEffect,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * What activations did to stored VALUES (plan schema-lenses, review): a lens compares two shapes, so it
 * cannot see that a step in between dropped or cut values (a text field made a number drops every value; a
 * list made single keeps only its first item, and making it a list again does not bring the rest back). The
 * review walks the activation steps between a client's version and now, plus the proposed change, and maps
 * each classified step to its effect on the values a client on an older version reads. Pure.
 */

const rank = (effect: LensEffect) => LENS_EFFECTS.indexOf(effect);

export const worstOf = (...effects: readonly LensEffect[]): LensEffect =>
  effects.reduce<LensEffect>((worst, effect) => (rank(effect) > rank(worst) ? effect : worst), 'transparent');

export const isWorse = (effect: LensEffect, than: LensEffect): boolean => rank(effect) > rank(than);

/**
 * Whether every value of the step's old type survives the conversion to its new one. `lensEffectOfChange`
 * answers the opposite direction (a client on the old type reading the new one), so it is asked about the
 * change reversed.
 */
const conversionKeepsEveryValue = (change: ClassifiedChange): boolean =>
  lensEffectOfChange({ ...change, from: change.to, to: change.from, dropsValues: false }) === 'converted';

/** What one classified step does to the stored values of its field. */
export const valueEffectOfChange = (change: ClassifiedChange): LensEffect => {
  if (change.dropsValues || change.kind === 'field.removed') {
    return 'nulled';
  }
  switch (change.kind) {
    case 'field.type':
      if (change.category !== 'conversion') {
        // Within one storage family the stored JSON stays as it is.
        return 'transparent';
      }
      return change.destructive || !conversionKeepsEveryValue(change) ? 'lossy' : 'converted';
    case 'field.settings':
      switch (change.property) {
        case 'multiple':
        case 'repeatable':
        case 'cardinality':
          // To single: only the first item is kept. To a list: the value becomes a one-item list.
          return change.to === false || change.to === 'one' ? 'lossy' : 'transparent';
        case 'component':
          return 'nulled';
        case 'formatVersion':
          return 'converted';
        default:
          return 'transparent';
      }
    case 'field.localized':
      // Made shared: one locale's value is kept for every locale.
      return change.to === false ? 'lossy' : 'transparent';
    default:
      return 'transparent';
  }
};

/** Per field ID, what the step `before` → `after` does to stored values. */
export const stepFieldEffects = (
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): Map<string, LensEffect> => {
  const effects = new Map<string, LensEffect>();
  const add = (fieldId: string, value: LensEffect) =>
    effects.set(fieldId, worstOf(value, effects.get(fieldId) ?? 'transparent'));
  for (const change of classifyChanges(diffDefinitions(before, after), { before, after })) {
    if (change.kind === 'model.localized' && change.to === false) {
      // Made shared: every field keeps one locale's value.
      for (const field of before?.fields ?? []) {
        add(field.id, 'lossy');
      }
    } else if (change.fieldId) {
      add(change.fieldId, valueEffectOfChange(change));
    }
  }
  return effects;
};

export type FieldHistory = {
  /** The worst effect activations since the client's version had on the field's values. */
  past: LensEffect;
  /** The schema version of the first step that reached `past`; null when `past` is transparent. */
  pastSince: number | null;
  /** The proposed change's effect on the field's values. */
  proposed: LensEffect;
};

export type HistoryStep = { schemaVersion: number; definition: SchemaDefinition };

/**
 * Walks `client` → each step → `current` (past) and `current` → `proposed` (the proposal), per field ID.
 * `steps` are the definitions activations made live after the client's version, oldest first.
 */
export const fieldHistoryOf = (input: {
  client: SchemaDefinition;
  steps: readonly HistoryStep[];
  current: SchemaDefinition | null;
  proposed: SchemaDefinition | null;
}): Map<string, FieldHistory> => {
  const history = new Map<string, FieldHistory>();
  const entry = (fieldId: string) => {
    let known = history.get(fieldId);
    if (!known) {
      known = { past: 'transparent', pastSince: null, proposed: 'transparent' };
      history.set(fieldId, known);
    }
    return known;
  };
  const dates = new Map<string, Array<{ schemaVersion: number; value: LensEffect }>>();
  let previous: SchemaDefinition = input.client;
  for (const step of input.steps) {
    for (const [fieldId, effect] of stepFieldEffects(previous, step.definition)) {
      const known = entry(fieldId);
      known.past = worstOf(known.past, effect);
      dates.set(fieldId, [
        ...(dates.get(fieldId) ?? []),
        { schemaVersion: step.schemaVersion, value: effect },
      ]);
    }
    previous = step.definition;
  }
  for (const [fieldId, known] of history) {
    known.pastSince =
      known.past === 'transparent'
        ? null
        : ((dates.get(fieldId) ?? []).find((date) => date.value === known.past)?.schemaVersion ?? null);
  }
  for (const [fieldId, effect] of stepFieldEffects(input.current, input.proposed)) {
    entry(fieldId).proposed = effect;
  }
  return history;
};
