import { storageFamilyOf, type DefinitionLens, type FieldLens } from '@shapio/schema';
import { lensQueryUnsupported } from '../../schema/errors.js';
import { toList, type QueryTree, type QueryValue } from '../compiler/querystring.js';
import { queryInvalid, SYSTEM_ATTRIBUTES } from '../compiler/types.js';

/**
 * A delivery querystring written in the client's schema version (its API IDs) rewritten into today's, so the
 * unchanged parser and compiler run it against today's storage (plan schema-lenses). Fields map by stable ID.
 * A filter, sort or search on a field that is gone or whose storage changed since is refused
 * (`LENS_QUERY_UNSUPPORTED`), never answered on another field or another storage. `fields=` may name a field
 * that is gone (it reads null); `populate` paths through a relation that is gone or whose target changed are
 * left out (the relation shows the IDs the client may see).
 */
export type QueryRewriteContext = {
  /** The lens of a relation's target, by the client's target ID (a model or an interface). */
  lensFor: (definitionId: string) => DefinitionLens | null | undefined;
  /** `filters[__model]`: a kind's client API ID → today's API ID; undefined for a kind unknown today. */
  kindApiKey?: (clientApiKey: string) => string | undefined;
  /**
   * A field the caller reads as null through the lens (public in the client's version, not readable today, an
   * unrestricted grant): `fields=` may name it like a field gone since; filters and sorts on it stay today's.
   */
  readsNull?: (fieldId: string) => boolean;
};

export type RewrittenQuery = {
  tree: QueryTree;
  /**
   * The client fields `fields=` named, by stable ID, in its order (gone ones included, which read null); null
   * when the query named none. The projection selects these; the rewritten tree names only today's.
   */
  selectedFieldIds: string[] | null;
};

const KIND_KEY = '__model';
const SYSTEM: ReadonlySet<string> = new Set(SYSTEM_ATTRIBUTES);

const isTree = (value: QueryValue | undefined): value is QueryTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const newTree = (): QueryTree => Object.create(null) as QueryTree;

const fieldByApiKey = (lens: DefinitionLens, apiKey: string): FieldLens | undefined => {
  const fieldId = lens.apiKeyToFieldId.get(apiKey);
  return fieldId === undefined ? undefined : lens.fields.find((field) => field.fieldId === fieldId);
};

const unknownField = (apiKey: string) => queryInvalid(`Unknown field "${apiKey}"`, { field: apiKey });

/** Today's API ID of a client field a query filters, sorts or searches on. */
const queryableApiKey = (lens: DefinitionLens, apiKey: string): string => {
  if (SYSTEM.has(apiKey)) {
    return apiKey;
  }
  const field = fieldByApiKey(lens, apiKey);
  if (!field) {
    throw unknownField(apiKey);
  }
  if (field.kind === 'null') {
    throw lensQueryUnsupported(apiKey);
  }
  if (storageFamilyOf(field.stored) !== storageFamilyOf(field.client)) {
    throw lensQueryUnsupported(apiKey);
  }
  return field.stored.apiKey;
};

const rewriteKinds = (value: QueryValue, context: QueryRewriteContext): QueryValue => {
  const one = (apiKey: string): string => {
    const current = context.kindApiKey?.(apiKey);
    if (current === undefined) {
      throw lensQueryUnsupported(apiKey);
    }
    return current;
  };
  // A bare value, a comma list, repeated values, or an operator tree of those.
  const list = (text: string) =>
    text
      .split(',')
      .filter((item) => item.length > 0)
      .map(one)
      .join(',');
  const any = (item: QueryValue): QueryValue => {
    if (typeof item === 'string') {
      return list(item);
    }
    if (Array.isArray(item)) {
      return item.map(list);
    }
    const tree = newTree();
    for (const [key, child] of Object.entries(item)) {
      tree[key] = any(child);
    }
    return tree;
  };
  return any(value);
};

const rewriteFilters = (lens: DefinitionLens, tree: QueryTree, context: QueryRewriteContext): QueryTree => {
  const rewritten = newTree();
  for (const [key, value] of Object.entries(tree)) {
    if (key === '$and' || key === '$or') {
      rewritten[key] = isTree(value)
        ? Object.fromEntries(
            Object.entries(value).map(([index, child]) => [
              index,
              isTree(child) ? rewriteFilters(lens, child, context) : child,
            ]),
          )
        : value;
    } else if (key === '$not') {
      rewritten[key] = isTree(value) ? rewriteFilters(lens, value, context) : value;
    } else if (key.startsWith('$')) {
      // Unknown keywords are the parser's to refuse.
      rewritten[key] = value;
    } else if (key === KIND_KEY) {
      rewritten[key] = rewriteKinds(value, context);
    } else {
      rewritten[queryableApiKey(lens, key)] = value;
    }
  }
  return rewritten;
};

const rewriteSort = (lens: DefinitionLens, value: QueryValue): QueryValue =>
  toList(value).map((item) => {
    if (typeof item !== 'string') {
      throw queryInvalid('sort needs "field" or "field:asc|desc" values');
    }
    const [key = '', ...rest] = item.split(':');
    return [queryableApiKey(lens, key), ...rest].join(':');
  });

const rewriteFields = (lens: DefinitionLens, value: QueryValue, context: QueryRewriteContext) => {
  const selected: string[] = [];
  const current: string[] = [];
  for (const item of toList(value)) {
    if (typeof item !== 'string') {
      throw queryInvalid('fields needs a list of field names');
    }
    if (SYSTEM.has(item)) {
      // The parser says these are always returned.
      current.push(item);
      continue;
    }
    const field = fieldByApiKey(lens, item);
    if (!field) {
      throw unknownField(item);
    }
    selected.push(field.fieldId);
    if (field.kind !== 'null' && !context.readsNull?.(field.fieldId)) {
      current.push(field.stored.apiKey);
    }
  }
  return { selected, current };
};

/** Whether a relation still points where the client's did, so a path below it means the same fields. */
const keepsTarget = (field: FieldLens): field is FieldLens & { kind: 'same' | 'convert' } =>
  field.kind !== 'null' &&
  field.client.type === 'relation' &&
  field.stored.type === 'relation' &&
  field.client.settings.target === field.stored.settings.target;

/** One populate path in today's API IDs; null when it runs through a relation that is gone or moved. */
const rewritePath = (lens: DefinitionLens, path: string, context: QueryRewriteContext): string | null => {
  const segments = path.split('.');
  const rewritten: string[] = [];
  let current: DefinitionLens | null | undefined = lens;
  for (const [index, segment] of segments.entries()) {
    if (!current) {
      // Below a relation to any entry: nothing to name; the parser refuses it.
      return [...rewritten, ...segments.slice(index)].join('.');
    }
    if (current.status === 'gone') {
      return null;
    }
    const field = fieldByApiKey(current, segment);
    if (!field || field.client.type !== 'relation') {
      throw queryInvalid(`"${segment}" is not a relation of "${current.apiKey}" and cannot be populated`);
    }
    if (!keepsTarget(field)) {
      return null;
    }
    rewritten.push(field.stored.apiKey);
    current = context.lensFor(field.client.settings.target);
  }
  return rewritten.join('.');
};

const rewritePopulate = (lens: DefinitionLens, value: QueryValue, context: QueryRewriteContext): string[] =>
  toList(value).flatMap((item) => {
    if (typeof item !== 'string') {
      throw queryInvalid('populate needs a list of relation paths');
    }
    if (item === '*') {
      return [item];
    }
    const path = rewritePath(lens, item, context);
    return path === null ? [] : [path];
  });

/**
 * The querystring tree (`parseQueryTree`) of a read through `lens`, in today's API IDs, with the fields `fields=`
 * selected. Every other parameter passes through unchanged for the parser to check; `q` searches today's
 * title field, as it does without a lens.
 */
export const rewriteQueryTree = (
  lens: DefinitionLens,
  tree: QueryTree,
  context: QueryRewriteContext,
): RewrittenQuery => {
  const rewritten = newTree();
  let selectedFieldIds: string[] | null = null;
  for (const [key, value] of Object.entries(tree)) {
    switch (key) {
      case 'filters':
        rewritten[key] = isTree(value) ? rewriteFilters(lens, value, context) : value;
        break;
      case 'sort':
        rewritten[key] = rewriteSort(lens, value);
        break;
      case 'fields': {
        const { selected, current } = rewriteFields(lens, value, context);
        selectedFieldIds = selected;
        if (current.length > 0) {
          rewritten[key] = current;
        }
        break;
      }
      case 'populate': {
        const paths = rewritePopulate(lens, value, context);
        if (paths.length > 0) {
          rewritten[key] = paths;
        }
        break;
      }
      default:
        rewritten[key] = value;
    }
  }
  return { tree: rewritten, selectedFieldIds };
};
