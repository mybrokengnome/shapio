import {
  BIGINTEGER_PATTERN,
  DATE_PATTERN,
  DATETIME_PATTERN,
  DECIMAL_PATTERN,
  isListValuedField,
  RICHTEXT_FORMAT,
  SLUG_PATTERN,
  TIME_PATTERN,
  UID_PATTERN,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Independent oracles for schema-lens properties: whether a value delivered for a client field has that
 * field's API shape (JS type, integer-ness, canonical formats, enum membership, list or single, component
 * shape, allowed dynamic-zone components), written from the documented API contract rather than reusing the
 * code under test. Used by the unit properties and the integration fuzz.
 */

export type ComponentLookup = (componentId: string) => SchemaDefinition | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Empty as the API emits it: null, or [] for a list. */
export const isEmptyApiValue = (value: unknown): boolean =>
  value === null || value === undefined || (Array.isArray(value) && value.length === 0);

type ShapeOptions = {
  /** Delivery output: media fields are asset objects with an `id`, rich text may carry `html` instead of `doc`. */
  delivery?: boolean;
  /**
   * The object is a component instance (single, list item or zone item): it must carry its item `id`, a
   * non-empty string, a system field in every version (plan item-ids). Set by the component and zone checks.
   */
  instance?: boolean;
};

const scalarIssue = (field: FieldDefinition, value: unknown): string | null => {
  const wrong = (expected: string) => `${field.type} expected ${expected}, got ${JSON.stringify(value)}`;
  switch (field.type) {
    case 'string':
    case 'text':
    case 'code':
      return typeof value === 'string' ? null : wrong('a string');
    case 'email':
      return typeof value === 'string' && value.includes('@') ? null : wrong('an email');
    case 'url':
      return typeof value === 'string' && URL.canParse(value) ? null : wrong('a URL');
    case 'slug':
      return typeof value === 'string' && SLUG_PATTERN.test(value) ? null : wrong('a slug');
    case 'uid':
      return typeof value === 'string' && UID_PATTERN.test(value) ? null : wrong('a uid');
    case 'date':
      return typeof value === 'string' && DATE_PATTERN.test(value) ? null : wrong('a date');
    case 'datetime':
      return typeof value === 'string' && DATETIME_PATTERN.test(value) ? null : wrong('a datetime');
    case 'time':
      return typeof value === 'string' && TIME_PATTERN.test(value) ? null : wrong('a time');
    case 'decimal':
      return typeof value === 'string' && DECIMAL_PATTERN.test(value) ? null : wrong('a decimal string');
    case 'biginteger':
      return typeof value === 'string' && BIGINTEGER_PATTERN.test(value)
        ? null
        : wrong('a biginteger string');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : wrong('a finite number');
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : wrong('an integer');
    case 'boolean':
      return typeof value === 'boolean' ? null : wrong('a boolean');
    default:
      return null;
  }
};

/**
 * Problems with `value` as the API value of the client's `field` (empty is always fine). Paths are JSON
 * pointers in the client's API IDs.
 */
export const apiShapeIssues = (
  field: FieldDefinition,
  value: unknown,
  components: ComponentLookup,
  path: string,
  options: ShapeOptions = {},
): string[] => {
  const list = isListValuedField(field);
  if (value === null || value === undefined) {
    // The projection (`content/compiler/select.ts`) emits an empty multi-value enum as null, lens or not.
    const nullable = field.type === 'enum';
    return list && !nullable ? [`${path}: list field is ${String(value)}, expected []`] : [];
  }
  if (field.type === 'json') {
    return [];
  }
  if (list && !Array.isArray(value)) {
    return [`${path}: list field holds ${JSON.stringify(value)}`];
  }
  if (!list && Array.isArray(value)) {
    return [`${path}: single field holds a list ${JSON.stringify(value)}`];
  }
  switch (field.type) {
    case 'enum': {
      const allowed = new Set(field.settings.values.map((entry) => entry.value));
      const items = list ? (value as unknown[]) : [value];
      return items.flatMap((item) =>
        typeof item === 'string' && allowed.has(item)
          ? []
          : [`${path}: enum value ${JSON.stringify(item)} not in [${[...allowed].join(',')}]`],
      );
    }
    case 'media':
    case 'relation': {
      const items = list ? (value as unknown[]) : [value];
      return items.flatMap((item) =>
        typeof item === 'string' || (options.delivery && isRecord(item) && typeof item.id === 'string')
          ? []
          : [`${path}: ${field.type} item ${JSON.stringify(item)} is no ID`],
      );
    }
    case 'richtext':
      return isRecord(value) &&
        value.format === RICHTEXT_FORMAT &&
        value.version === field.settings.formatVersion &&
        (isRecord(value.doc) || (options.delivery && typeof value.html === 'string'))
        ? []
        : [
            `${path}: rich text ${JSON.stringify(value).slice(0, 80)} is not format version ${field.settings.formatVersion}`,
          ];
    case 'component': {
      const component = components(field.settings.component);
      const items = list ? (value as unknown[]) : [value];
      return items.flatMap((item, index) =>
        instanceIssues(component, item, components, list ? `${path}/${index}` : path, {
          ...options,
          instance: true,
        }),
      );
    }
    case 'dynamiczone':
      return (value as unknown[]).flatMap((item, index) => {
        const at = `${path}/${index}`;
        if (!isRecord(item)) {
          return [`${at}: zone item is not an object`];
        }
        const component = field.settings.components
          .map((id) => components(id))
          .find((candidate) => candidate?.apiKey === item.__component);
        if (!component) {
          return [
            `${at}: zone item of component ${JSON.stringify(item.__component)} the client does not allow`,
          ];
        }
        const { __component: _component, ...rest } = item;
        return instanceIssues(component, rest, components, at, { ...options, instance: true });
      });
    default: {
      const problem = scalarIssue(field, value);
      return problem ? [`${path}: ${problem}`] : [];
    }
  }
};

/** Problems with an object as an instance of `definition` (keys must be its API IDs). */
export const instanceIssues = (
  definition: SchemaDefinition | undefined,
  value: unknown,
  components: ComponentLookup,
  path: string,
  options: ShapeOptions = {},
): string[] => {
  if (!definition) {
    return [`${path}: instance of a component the client does not know`];
  }
  if (!isRecord(value)) {
    return [`${path}: ${JSON.stringify(value)} is not an object`];
  }
  const byApiKey = new Map(definition.fields.map((field) => [field.apiKey, field]));
  const idIssues =
    options.instance && (typeof value.id !== 'string' || value.id === '')
      ? [`${path}: component instance without its item id (${JSON.stringify(value.id)})`]
      : [];
  const fieldOptions = { ...options, instance: false };
  return [
    ...idIssues,
    ...Object.entries(value).flatMap(([key, item]) => {
      if (options.instance && key === 'id') {
        return [];
      }
      const field = byApiKey.get(key);
      if (!field) {
        return [`${path}/${key}: not a field of the client's ${definition.apiKey}`];
      }
      return apiShapeIssues(field, item, components, `${path}/${key}`, fieldOptions);
    }),
  ];
};

/**
 * `value` (a delivered object of `definition`) without the item `id` of any component instance in it, at any
 * depth: for comparing values, which item IDs are not.
 */
export const withoutItemIds = (
  definition: SchemaDefinition | undefined,
  value: Record<string, unknown>,
  components: ComponentLookup,
): Record<string, unknown> => {
  if (!definition) {
    return value;
  }
  const output: Record<string, unknown> = { ...value };
  for (const field of definition.fields) {
    const item = value[field.apiKey];
    if (field.type !== 'component' && field.type !== 'dynamiczone') {
      continue;
    }
    const strip = (instance: unknown): unknown => {
      if (!isRecord(instance)) {
        return instance;
      }
      const { id: _id, ...rest } = instance;
      const component =
        field.type === 'component'
          ? components(field.settings.component)
          : field.settings.components
              .map((id) => components(id))
              .find((c) => c?.apiKey === instance.__component);
      return withoutItemIds(component, rest, components);
    };
    if (Array.isArray(item)) {
      output[field.apiKey] = item.map(strip);
    } else if (isRecord(item)) {
      output[field.apiKey] = strip(item);
    }
  }
  return output;
};

/** Storage-form data without the `__id` of any component instance (at any depth): values only. */
export const withoutStoredItemIds = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutStoredItemIds);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '__id')
        .map(([key, item]) => [key, withoutStoredItemIds(item)]),
    );
  }
  return value;
};

/**
 * Calls `visit` for every client field value in a delivered object of `definition`, at any depth (component
 * instances and zone items included), with the field's client definition.
 */
export const walkDelivered = (
  definition: SchemaDefinition,
  value: Record<string, unknown>,
  components: ComponentLookup,
  visit: (field: FieldDefinition, item: unknown, path: string, present: boolean) => void,
  path = '',
): void => {
  for (const field of definition.fields) {
    const present = Object.hasOwn(value, field.apiKey);
    const item = value[field.apiKey];
    const at = `${path}/${field.apiKey}`;
    visit(field, item, at, present);
    const instances: Array<[SchemaDefinition | undefined, unknown, string]> = [];
    if (field.type === 'component') {
      const component = components(field.settings.component);
      if (Array.isArray(item)) {
        item.forEach((entry, index) => instances.push([component, entry, `${at}/${index}`]));
      } else {
        instances.push([component, item, at]);
      }
    } else if (field.type === 'dynamiczone' && Array.isArray(item)) {
      item.forEach((entry, index) => {
        const component = isRecord(entry)
          ? field.settings.components.map((id) => components(id)).find((c) => c?.apiKey === entry.__component)
          : undefined;
        instances.push([component, entry, `${at}/${index}`]);
      });
    }
    for (const [component, entry, at2] of instances) {
      if (component && isRecord(entry)) {
        walkDelivered(component, entry, components, visit, at2);
      }
    }
  }
};

/**
 * The no-ID rule (plan item-ids, review 5) for a list whose items can hold values the caller cannot see, as an
 * independent set rule over what the caller sees of each item (`callerView`): the sent list equal to the stored
 * one item for item continues it; nothing stored makes every item new; otherwise every item must be distinct on
 * both sides and the write must not both delete and add: equal items continue wherever they moved, a stored item
 * with no equal is deleted, a sent item with no equal is new. Anything else: null (AMBIGUOUS_ITEMS).
 */
export const setRulePairs = (sent: readonly string[], stored: readonly string[]): number[] | null => {
  if (stored.length === 0) {
    return sent.map(() => -1);
  }
  if (sent.length === stored.length && sent.every((view, index) => view === stored[index])) {
    return sent.map((_, index) => index);
  }
  if (new Set(stored).size !== stored.length || new Set(sent).size !== sent.length) {
    return null;
  }
  const pairs = sent.map((view) => stored.indexOf(view));
  const added = pairs.includes(-1);
  const deleted = pairs.filter((pair) => pair !== -1).length < stored.length;
  return added && deleted ? null : pairs;
};
