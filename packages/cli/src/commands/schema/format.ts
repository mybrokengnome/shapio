import { type SchemaSyncResult, type ShapioApiError } from '@shapio/client';
import {
  categoryOfKind,
  isDataType,
  typeChangeDropsValues,
  type PlannedChange,
  type SchemaChange,
} from '@shapio/schema';

/**
 * Human-readable output for schema sync: decisions, per-definition diffs and server refusals. Definitions and
 * fields are named by API ID wherever the files (`names`, by stable ID) or the payload know one, never by ID.
 */

/**
 * Each local model's parent (`extends`, a stable ID), keyed by the model's stable ID and by `parentKeyOf` its
 * API ID: the files' view, for `model guide (extends post)`, also for a new file without an ID.
 */
export type ParentIds = ReadonlyMap<string, string>;

/**
 * The interfaces each local model implements itself (`implements`, stable IDs), keyed like `ParentIds`: for
 * `model post (implements featurable, listable)`.
 */
export type ImplementedIds = ReadonlyMap<string, readonly string[]>;

/** The `ParentIds` (and `ImplementedIds`) key of a model by API ID (a stable ID never contains `:`). */
export const parentKeyOf = (apiKey: string) => `apiKey:${apiKey}`;

/** A definition's API ID from the files, else its ID; `(none)` for a model that extends nothing. */
const definitionName = (id: unknown, names: ReadonlyMap<string, string>): string =>
  typeof id === 'string' && id !== '' ? (names.get(id) ?? id) : '(none)';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
};

/** A value in full, as one line of JSON with sorted keys, so both sides of a change read in the same order. */
const show = (value: unknown): string => (value === undefined ? '(unset)' : JSON.stringify(sortKeys(value)));

/** Lists of objects (groups, enum options) are compared item by item; lists of IDs or values are shown whole. */
const isObjectList = (value: unknown): value is unknown[] => Array.isArray(value) && value.some(isObject);

type Difference = { path: string; from: unknown; to: unknown };

/**
 * The parts of two values that differ, with paths like `.groups[1].label`: objects key by key and lists of
 * objects item by item, so a change inside a large value (a form layout) shows only what changed.
 */
const differences = (from: unknown, to: unknown, path = ''): Difference[] => {
  if (isObject(from) && isObject(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    return keys.flatMap((key) => differences(from[key], to[key], `${path}.${key}`));
  }
  if (isObjectList(from) && isObjectList(to)) {
    return Array.from({ length: Math.max(from.length, to.length) }, (_, index) =>
      differences(from[index], to[index], `${path}[${index}]`),
    ).flat();
  }
  return show(from) === show(to) ? [] : [{ path, from, to }];
};

const fieldName = (change: SchemaChange, names: ReadonlyMap<string, string>) => {
  const fromPayload = (value: unknown) => (value as { apiKey?: string } | undefined)?.apiKey;
  return (
    fromPayload(change.to) ??
    fromPayload(change.from) ??
    names.get(change.fieldId ?? '') ??
    change.fieldId ??
    '?'
  );
};

/**
 * A type change Shapio can't convert: every stored value of the field is dropped. The server classifies each
 * change from both sides' type and settings (`dropsValues`); an older server sends no flag, so the CLI falls
 * back to the type names, which can't see a multi-value enum.
 */
const dropsValues = (change: PlannedChange) => {
  if (change.kind !== 'field.type') {
    return false;
  }
  if (change.dropsValues !== undefined) {
    return change.dropsValues;
  }
  return (
    isDataType(change.from) &&
    isDataType(change.to) &&
    typeChangeDropsValues({ type: change.from }, { type: change.to })
  );
};

type FormatChangeOptions = {
  /** The change is on an interface: its fields are contract fields. */
  contract?: boolean;
};

/**
 * The lines for one change, `+` added, `-` removed, `~` changed. Values are printed in full; a change inside
 * an object prints one line per part that changed. A type change that drops values says so.
 */
export const formatChange = (
  change: PlannedChange,
  names: ReadonlyMap<string, string>,
  { contract = false }: FormatChangeOptions = {},
): string[] => {
  const field = change.fieldId ? `${contract ? 'contract field' : 'field'} ${fieldName(change, names)}` : '';
  switch (change.kind) {
    case 'definition.added':
      return [`+ definition ${show(change.to)}`];
    case 'definition.removed':
      return [`- definition ${show(change.from)}`];
    case 'field.added':
      return [`+ ${field}`];
    case 'field.removed':
      return [`- ${field}`];
    case 'field.order':
      return [contract ? '~ contract field order' : '~ field order'];
    case 'model.extends':
      return [`~ extends: ${definitionName(change.from, names)} → ${definitionName(change.to, names)}`];
    case 'model.implements': {
      // One change per interface: `to` names it when the type starts implementing it, `from` when it stops.
      const added = typeof change.to === 'string' && change.to !== '';
      return [
        `${added ? '+' : '-'} implements ${definitionName(change.property ?? (added ? change.to : change.from), names)}`,
      ];
    }
    default: {
      const subject = change.kind.startsWith('field.') ? `${field} ` : '';
      const property = change.property ?? change.kind.split('.')[1] ?? change.kind;
      const dropped = dropsValues(change) ? ' (values dropped)' : '';
      const parts = differences(change.from, change.to);
      return (parts.length > 0 ? parts : [{ path: '', from: change.from, to: change.to }]).map(
        (part) => `~ ${subject}${property}${part.path}: ${show(part.from)} → ${show(part.to)}${dropped}`,
      );
    }
  }
};

const DECISION_LABELS: Readonly<Record<string, string>> = {
  unchangedLocally: 'unchanged locally',
  alreadyApplied: 'already identical on the target',
  remoteOnly: 'only on the target (pull to get it)',
  deletedLocallyWithoutPrune: 'deleted locally; pass --prune to delete it on the target',
  alreadyDeleted: 'already deleted on the target',
  changedOnBoth: 'changed locally AND on the target since your last pull',
  deletedOnTarget: 'changed locally but deleted on the target',
  existsOnTarget: 'new locally but the target already has a different definition with this ID',
  changedOnTargetBeforeDelete: 'deleted locally but changed on the target since your last pull',
};

export const describeDecision = (item: SchemaSyncResult): string => {
  const { decision } = item;
  if (decision.action === 'skip' || decision.action === 'conflict') {
    return `${decision.action}: ${DECISION_LABELS[decision.reason] ?? decision.reason}`;
  }
  return decision.action;
};

/**
 * A change the server reports on another member of the item's family (a parent's new field, as each kind
 * that inherits it sees it) names that member, so the same line twice never reads as a duplicate.
 */
const onMember = (change: PlannedChange, item: SchemaSyncResult, names: ReadonlyMap<string, string>) =>
  change.definitionId && change.definitionId !== item.definitionId
    ? ` (on ${definitionName(change.definitionId, names)})`
    : '';

/** ` (implements featurable, listable)` for a model whose files declare interfaces, else nothing. */
const implementsNote = (
  item: SchemaSyncResult,
  names: ReadonlyMap<string, string>,
  implemented: ImplementedIds,
) => {
  const ids = implemented.get(item.definitionId) ?? implemented.get(parentKeyOf(item.apiKey)) ?? [];
  return ids.length === 0 ? '' : ` (implements ${ids.map((id) => definitionName(id, names)).join(', ')})`;
};

export const formatItem = (
  item: SchemaSyncResult,
  names: ReadonlyMap<string, string>,
  parents: ParentIds = new Map(),
  implemented: ImplementedIds = new Map(),
): string => {
  const flags = [
    item.plan?.summary?.breaking ? 'BREAKING' : '',
    item.plan?.summary?.destructive ? 'DESTRUCTIVE' : '',
    item.outcome === 'pending' ? `pending change ${item.changeId ?? ''}` : '',
  ].filter(Boolean);
  const parent = parents.get(item.definitionId) ?? parents.get(parentKeyOf(item.apiKey));
  const extendsNote = parent === undefined ? '' : ` (extends ${definitionName(parent, names)})`;
  const category = categoryOfKind(item.kind);
  const header = `${category} ${item.apiKey}${extendsNote}${implementsNote(item, names, implemented)}: ${describeDecision(item)}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  const lines = item.changes.flatMap((change) => {
    const member = onMember(change, item, names);
    // A change the server reports on a member (a type implementing the interface) is about that type's fields.
    const contract = category === 'interface' && member === '';
    return formatChange(change, names, { contract }).map((line) => `    ${line}${member}`);
  });
  return [header, ...lines].join('\n');
};

type Issue = { path?: string; code?: string; message?: string; definitionId?: string; siteKey?: string };
type ScopeItem = {
  definitionId?: string;
  apiKey?: string;
  local?: string;
  remote?: string;
  scope?: string;
  message?: string;
};
type SiteCount = { key?: string | null; siteId?: string; entries?: number };
type ErrorDetails = {
  conflicts?: SchemaSyncResult[];
  issues?: Issue[];
  items?: ScopeItem[];
  sites?: Array<SiteCount | string>;
  site?: string;
};

const FOLDER_OF: Readonly<Record<string, string>> = {
  network: 'the shared folders',
  site: 'the site’s folder',
};
const PLACE_OF: Readonly<Record<string, string>> = { network: 'shared', site: 'on one site' };
const SCOPE_OF: Readonly<Record<string, string>> = { network: 'shared', site: 'site' };

/** One line per item of a scope refusal (`SCOPE_MISMATCH`, `FORBIDDEN_SCOPE`). */
const scopeItemLines = (code: string, items: readonly ScopeItem[]) =>
  items.map((item) => {
    const name = item.apiKey ?? item.definitionId ?? '?';
    return code === 'SCOPE_MISMATCH'
      ? `  ${name}: its file is in ${FOLDER_OF[item.local ?? ''] ?? '?'}, but on the instance it is ${PLACE_OF[item.remote ?? ''] ?? '?'}`
      : `  ${name} (${SCOPE_OF[item.scope ?? ''] ?? item.scope ?? '?'}): ${item.message ?? 'not allowed'}`;
  });

/** What to do next, per refusal (an error code, or the code of an issue in an invalid file). */
const HINTS: Readonly<Record<string, string>> = {
  SCHEMA_CHANGE_NOT_ACKNOWLEDGED:
    'Review the changes with `shapio schema diff`, then re-run with --allow-breaking and/or --allow-destructive.',
  SCHEMA_SYNC_CONFLICT:
    'Commit your files, run `shapio schema pull --force`, reconcile with git, then apply again.',
  SCOPE_MISMATCH:
    'Sync never moves a definition between sites: run `shapio schema pull` to get the instance’s layout, or change the scope with `shapio schema scope`.',
  FORBIDDEN_SCOPE:
    'Shared definitions (in models/, components/, and interfaces/) need schema permission on every site: apply with a network token, or leave those files unchanged.',
  UNKNOWN_PARENT:
    '"extends" holds the stable ID of the parent type: check the ID, or add the parent’s file (it can be in the same apply).',
  INVALID_PARENT:
    'Only a collection can extend another collection, and both must be in the same place: both shared (models/), or both in one site’s folder.',
  INHERITANCE_CYCLE:
    'Follow the "extends" chain from the type named above and remove the link that leads back to it.',
  INHERITANCE_TOO_DEEP: 'A family can be at most 8 types deep: make the type extend one higher up the chain.',
  INHERITED_FLAG_MISMATCH:
    'A type and the type it extends must agree on "localized" and "draftAndPublish": set the value the message names.',
  INHERITED_FIELD_COLLISION:
    'A type cannot declare a field its parent already has: rename its own field, or remove it and use the inherited one.',
  HAS_CHILDREN: 'Delete the types that extend it first, or make them extend another type, then apply again.',
  UNKNOWN_INTERFACE:
    '"implements" holds the stable IDs of interfaces: check the ID, or add the interface’s file (it can be in the same apply).',
  INVALID_INTERFACE:
    'Only a collection or a single type can implement an interface, "implements" can only name interfaces, and an interface on one site can only be implemented by types on that site.',
  INTERFACE_FIELD_MISSING:
    'Give the type the field the message names (the same API ID, a compatible type, and the flags the interface sets), or remove the interface from "implements" in the same apply.',
  INTERFACE_FIELD_MISMATCH:
    'Make the type’s field match the interface’s: the same type, every flag the interface sets, and the settings the message names.',
  INVALID_INTERFACE_FIELD:
    'An interface’s field can’t be a component or a dynamic zone, can’t be unique, and a slug in it can’t name a source field.',
  RELATION_VALUES_EXIST:
    'Remove the references the message counts (in the admin, or with the content API), or keep the type in the interface, then apply again.',
  HAS_MEMBERS:
    'Remove the interface from "implements" on every type that names it, then delete it. A relation that targets it must target something else first.',
};

const issueWhere = (found: Issue, filePaths: readonly string[]) => {
  const match = /^\/definitions\/(\d+)(.*)$/.exec(found.path ?? '');
  const where = match
    ? `${filePaths[Number(match[1])] ?? `definition ${match[1]}`} ${match[2] || '/'}`
    : (found.path ?? '');
  return found.siteKey ? `${where} (site ${found.siteKey})` : where;
};

const siteCountLines = (sites: ErrorDetails['sites']) =>
  (sites ?? []).flatMap((site) =>
    typeof site === 'object' && site.entries !== undefined
      ? [`  site ${site.key ?? site.siteId ?? '?'}: ${site.entries} entr${site.entries === 1 ? 'y' : 'ies'}`]
      : [],
  );

/** Explains a refused request: conflicts with diffs, invalid files, scope refusals, missing acknowledgements. */
export const formatApiError = (
  error: ShapioApiError,
  filePaths: readonly string[],
  names: ReadonlyMap<string, string>,
  parents: ParentIds = new Map(),
  implemented: ImplementedIds = new Map(),
): string => {
  const details = (error.details ?? {}) as ErrorDetails;
  const lines = [`${error.code}: ${error.message}`];
  for (const conflict of details.conflicts ?? []) {
    lines.push(formatItem(conflict, names, parents, implemented));
  }
  for (const found of details.issues ?? []) {
    lines.push(`  ${issueWhere(found, filePaths)}: ${found.message ?? ''}`);
  }
  lines.push(...scopeItemLines(error.code, details.items ?? []));
  if (error.code === 'SCOPE_IN_USE') {
    lines.push(...siteCountLines(details.sites));
  }
  const codes = new Set([error.code, ...(details.issues ?? []).flatMap((found) => found.code ?? [])]);
  lines.push(...[...codes].flatMap((code) => HINTS[code] ?? []));
  return `${lines.join('\n')}\n`;
};
