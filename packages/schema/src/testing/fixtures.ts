import { normalizeDefinition, type FieldInputWithId } from '../normalize.js';
import type {
  ComponentDefinition,
  ComponentDefinitionInput,
  FieldDefinition,
  FieldInput,
  ModelDefinition,
  ModelDefinitionInput,
} from '../types/definitions.js';

/** Deterministic UUIDs for tests: id(1) = 00000000-0000-4000-8000-000000000001. */
export const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

let counter = 1000;
const nextId = () => id((counter += 1));

export const field = (input: Partial<FieldInput> & Pick<FieldInput, 'apiKey'>): FieldInputWithId => ({
  id: input.id ?? nextId(),
  label: input.label ?? input.apiKey,
  type: input.type ?? 'string',
  ...input,
});

/** Field inputs, or already-normalized fields (e.g. copied from another fixture). */
type FixtureFields = ReadonlyArray<FieldInputWithId | FieldDefinition>;

export const model = (
  input: Partial<Omit<ModelDefinitionInput, 'fields' | 'display'>> & {
    fields?: FixtureFields;
    display?: ModelDefinitionInput['display'] | ModelDefinition['display'];
  } = {},
): ModelDefinition =>
  normalizeDefinition({
    id: input.id ?? nextId(),
    kind: input.kind ?? 'collection',
    apiKey: input.apiKey ?? 'page',
    label: input.label ?? 'Page',
    ...input,
    fields: (input.fields ?? []) as FieldInputWithId[],
  }) as ModelDefinition;

export const component = (
  input: Partial<Omit<ComponentDefinitionInput, 'fields' | 'kind'>> & { fields?: FixtureFields } = {},
): ComponentDefinition =>
  normalizeDefinition({
    id: input.id ?? nextId(),
    kind: 'component',
    apiKey: input.apiKey ?? 'hero',
    label: input.label ?? 'Hero',
    ...input,
    fields: (input.fields ?? []) as FieldInputWithId[],
  }) as ComponentDefinition;

/** Returns a copy of the definition with one field replaced by `update(field)`. */
export const withField = <T extends ModelDefinition | ComponentDefinition>(
  definition: T,
  fieldId: string,
  update: (field: FieldDefinition) => FieldDefinition,
): T => ({
  ...definition,
  fields: definition.fields.map((candidate) => (candidate.id === fieldId ? update(candidate) : candidate)),
});
