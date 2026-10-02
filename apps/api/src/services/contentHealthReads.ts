import { effectiveTitleField, isComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { maskAllows, matchesRowFilter } from '../content/compiler/policy.js';
import type { HealthRule } from '../content/health/rules.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import * as contentHealthFindingsRepository from '../repositories/contentHealthFindings.js';
import type { OpenFindingRow } from '../repositories/contentHealthFindings.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * The Inbox's reads of health findings. Only models the caller may read are included, rows outside the
 * caller's row filter are left out (no existence oracle), and titles honour the read mask.
 */
export type FindingView = {
  id: string;
  entryId: string;
  modelId: string;
  modelKey: string;
  entryTitle: string | null;
  locale: string;
  rule: HealthRule;
  subject: string;
  severity: 'error' | 'warning';
  path?: string;
  params: Record<string, string | number | null>;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type FindingsQuery = { rule?: HealthRule; modelKey?: string; cursor?: string; limit?: number };

const DEFAULT_LIMIT = 50;

type Readable = { definition: ModelDefinition; policy: Policy };

/** The models the caller may read, with their read policies, by model ID. */
const readableModels = async (context: ContentServiceContext, modelKey?: string) => {
  const models = context.snapshot.definitions
    .map((active) => active.definition)
    .filter((definition): definition is ModelDefinition => !isComponentDefinition(definition))
    .filter((definition) => modelKey === undefined || definition.apiKey === modelKey);
  const policies = await Promise.all(
    models.map((definition) =>
      context.permissions.evaluate(context.actor, { action: 'read', modelId: definition.id }),
    ),
  );
  const readable = new Map<string, Readable>();
  models.forEach((definition, index) => {
    const policy = policies[index];
    if (policy?.allowed) {
      readable.set(definition.id, { definition, policy });
    }
  });
  return readable;
};

const encodeCursor = (row: OpenFindingRow) =>
  Buffer.from(JSON.stringify([row.last_seen_at.toISOString(), row.id])).toString('base64url');

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) {
    return undefined;
  }
  try {
    const [lastSeenAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    return { lastSeenAt: new Date(lastSeenAt), id };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
  }
};

/** The entry's title in the finding's locale, else the default locale, when the read mask shows it. */
const titlesFor = async (
  context: ContentServiceContext,
  rows: readonly OpenFindingRow[],
  readable: Map<string, Readable>,
) => {
  const drafts = await entryHeadsRepository.findDraftsForEntries(
    [...new Set(rows.map((row) => row.entry_id))],
    context.db,
  );
  return (row: OpenFindingRow): string | null => {
    const model = readable.get(row.model_id);
    const field = model ? effectiveTitleField(model.definition) : undefined;
    if (!model || !field || !maskAllows(model.policy.readMask, field)) {
      return null;
    }
    const ofEntry = drafts.filter((draft) => draft.entry_id === row.entry_id);
    const head =
      ofEntry.find((draft) => draft.locale === row.locale) ??
      ofEntry.find((draft) => draft.locale === context.snapshot.defaultLocale) ??
      ofEntry[0];
    const value = head?.data?.[field.id];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
};

/** Open findings, newest first, one page at a time. */
export const listFindings = async (context: ContentServiceContext, query: FindingsQuery) => {
  const readable = await readableModels(context, query.modelKey);
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 200);
  const after = decodeCursor(query.cursor);
  const rows = await contentHealthFindingsRepository.listOpen(
    {
      modelIds: [...readable.keys()],
      ...(query.rule ? { rule: query.rule } : {}),
      ...(after ? { after } : {}),
      limit,
    },
    context.db,
  );
  const visible = rows.filter((row) => {
    const model = readable.get(row.model_id);
    return model !== undefined && matchesRowFilter(model.policy.rowFilter, context.actor, row);
  });
  const titleOf = await titlesFor(context, visible, readable);
  const last = rows.at(-1);
  return {
    items: visible.map((row): FindingView => ({
      id: row.id,
      entryId: row.entry_id,
      modelId: row.model_id,
      modelKey: readable.get(row.model_id)?.definition.apiKey ?? '',
      entryTitle: titleOf(row),
      locale: row.locale,
      rule: row.rule as HealthRule,
      subject: row.subject,
      severity: row.severity as FindingView['severity'],
      ...(row.path ? { path: row.path } : {}),
      params: row.details as FindingView['params'],
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
    })),
    nextCursor: rows.length === limit && last ? encodeCursor(last) : null,
  };
};

/**
 * Open findings per rule. Models with a row filter are counted from the rows the caller can see, the
 * others with one GROUP BY.
 */
export const summarizeFindings = async (context: ContentServiceContext) => {
  const readable = await readableModels(context);
  const unfiltered = [...readable.values()].filter((model) => model.policy.rowFilter === null);
  const filtered = [...readable.values()].filter((model) => model.policy.rowFilter !== null);
  const counts = new Map<string, number>();
  const add = (rule: string, count: number) => counts.set(rule, (counts.get(rule) ?? 0) + count);
  for (const row of await contentHealthFindingsRepository.countOpenByRule(
    unfiltered.map((model) => model.definition.id),
    context.db,
  )) {
    add(row.rule, Number(row.count));
  }
  for (const model of filtered) {
    const rows = await contentHealthFindingsRepository.listOpen(
      { modelIds: [model.definition.id], limit: 10_000 },
      context.db,
    );
    rows
      .filter((row) => matchesRowFilter(model.policy.rowFilter, context.actor, row))
      .forEach((row) => add(row.rule, 1));
  }
  return {
    rules: [...counts]
      .map(([rule, count]) => ({ rule: rule as HealthRule, count }))
      .sort((a, b) => a.rule.localeCompare(b.rule)),
  };
};
