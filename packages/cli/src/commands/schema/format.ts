import { type SchemaSyncResult, type ShapioApiError } from '@shapio/client';
import type { SchemaChange } from '@shapio/schema';

/** Human-readable output for schema sync: decisions, per-definition diffs and server refusals. */

const show = (value: unknown): string => {
  if (value === undefined) {
    return '(unset)';
  }
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
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

/** One line per change, `+` added, `-` removed, `~` changed. */
export const formatChange = (change: SchemaChange, names: ReadonlyMap<string, string>): string => {
  const field = change.fieldId ? fieldName(change, names) : '';
  switch (change.kind) {
    case 'definition.added':
      return `+ definition ${show(change.to)}`;
    case 'definition.removed':
      return `- definition ${show(change.from)}`;
    case 'field.added':
      return `+ field ${field}`;
    case 'field.removed':
      return `- field ${field}`;
    case 'field.order':
      return '~ field order';
    default: {
      const subject = change.kind.startsWith('field.') ? `field ${field} ` : '';
      const property = change.property ?? change.kind.split('.')[1] ?? change.kind;
      return `~ ${subject}${property}: ${show(change.from)} → ${show(change.to)}`;
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

export const formatItem = (item: SchemaSyncResult, names: ReadonlyMap<string, string>): string => {
  const flags = [
    item.plan?.summary?.breaking ? 'BREAKING' : '',
    item.plan?.summary?.destructive ? 'DESTRUCTIVE' : '',
    item.outcome === 'pending' ? `pending change ${item.changeId ?? ''}` : '',
  ].filter(Boolean);
  const header = `${item.kind === 'component' ? 'component' : 'model'} ${item.apiKey}: ${describeDecision(item)}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  const lines = item.changes.map((change) => `    ${formatChange(change, names)}`);
  return [header, ...lines].join('\n');
};

type Issue = { path?: string; message?: string; definitionId?: string; siteKey?: string };
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

/** What to do next, per refusal. */
const HINTS: Readonly<Record<string, string>> = {
  SCHEMA_CHANGE_NOT_ACKNOWLEDGED:
    'Review the changes with `shapio schema diff`, then re-run with --allow-breaking and/or --allow-destructive.',
  SCHEMA_SYNC_CONFLICT:
    'Commit your files, run `shapio schema pull --force`, reconcile with git, then apply again.',
  SCOPE_MISMATCH:
    'Sync never moves a definition between sites: run `shapio schema pull` to get the instance’s layout, or change the scope with `shapio schema scope`.',
  FORBIDDEN_SCOPE:
    'Shared definitions (in models/ and components/) need schema permission on every site: apply with a network token, or leave those files unchanged.',
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
): string => {
  const details = (error.details ?? {}) as ErrorDetails;
  const lines = [`${error.code}: ${error.message}`];
  for (const conflict of details.conflicts ?? []) {
    lines.push(formatItem(conflict, names));
  }
  for (const found of details.issues ?? []) {
    lines.push(`  ${issueWhere(found, filePaths)}: ${found.message ?? ''}`);
  }
  lines.push(...scopeItemLines(error.code, details.items ?? []));
  if (error.code === 'SCOPE_IN_USE') {
    lines.push(...siteCountLines(details.sites));
  }
  const hint = HINTS[error.code];
  if (hint) {
    lines.push(hint);
  }
  return `${lines.join('\n')}\n`;
};
