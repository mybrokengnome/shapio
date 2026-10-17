import { effectiveTitleField, isModelDefinition, type ResolvedModelDefinition } from '@shapio/schema';
import { everyRowReadMask, maskAllows, matchesRowFilter } from '../content/compiler/policy.js';
import type { HealthRule } from '../content/health/rules.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import * as contentHealthFindingsRepository from '../repositories/contentHealthFindings.js';
import type { OpenFindingRow } from '../repositories/contentHealthFindings.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * The Inbox's reads of health findings. Only models the caller may read are included, rows outside the
 * caller's row filter are left out (no existence oracle), and titles honor the read mask.
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
  /**
   * A relation finding's linked entry's title, only when the caller may read that entry and its title field
   * (left out otherwise, so it never tells whether a hidden entry exists).
   */
  targetTitle?: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type FindingsQuery = { rule?: HealthRule; modelKey?: string; cursor?: string; limit?: number };

const DEFAULT_LIMIT = 50;

type Readable = { definition: ResolvedModelDefinition; policy: Policy };

/**
 * Every model the caller may read, with its read policy, by model ID. Effective definitions: a kind's
 * title may be inherited (plan polymorphic-types).
 */
const readableModels = async (context: ContentServiceContext) => {
  const models = context.snapshot.definitions
    .map((active) => active.definition)
    .filter(isModelDefinition)
    .flatMap((definition) => context.snapshot.resolve(definition.id) ?? []);
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

/** The readable models with the given API ID (all of them without one). */
const withModelKey = (readable: Map<string, Readable>, modelKey: string | undefined) =>
  modelKey === undefined
    ? readable
    : new Map([...readable].filter(([, model]) => model.definition.apiKey === modelKey));

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

type DraftRow = Awaited<ReturnType<typeof entryHeadsRepository.findDraftsForEntries>>[number];

/** Rules whose findings name a linked entry (`targetEntryId` in their details). */
const LINK_RULES: ReadonlySet<string> = new Set<HealthRule>(['relationUnpublished', 'relationMissing']);

const targetIdOf = (row: OpenFindingRow): string | undefined => {
  const id = (row.details as FindingView['params']).targetEntryId;
  return LINK_RULES.has(row.rule) && typeof id === 'string' ? id : undefined;
};

/**
 * Titles for the page in two queries: the drafts of the findings' entries and of the entries they link to,
 * and the linked entries' rows (for the row filter). A title is the title field's value in the finding's
 * locale, else the default locale, else any, and only when the read mask shows that field.
 */
const titlesFor = async (
  context: ContentServiceContext,
  rows: readonly OpenFindingRow[],
  readable: Map<string, Readable>,
) => {
  const targetIds = [...new Set(rows.flatMap((row) => targetIdOf(row) ?? []))];
  const [drafts, targets] = await Promise.all([
    entryHeadsRepository.findDraftsForEntries(
      [...new Set([...rows.map((row) => row.entry_id), ...targetIds])],
      context.db,
    ),
    entriesRepository.findByIds(targetIds, context.db),
  ]);
  const draftsByEntry = new Map<string, DraftRow[]>();
  for (const draft of drafts) {
    draftsByEntry.set(draft.entry_id, [...(draftsByEntry.get(draft.entry_id) ?? []), draft]);
  }
  const targetById = new Map(targets.map((entry) => [entry.id, entry]));
  const titleOf = (entryId: string, model: Readable | undefined, locale: string): string | null => {
    const field = model ? effectiveTitleField(model.definition) : undefined;
    if (!model || !field || !maskAllows(everyRowReadMask(model.policy), field)) {
      return null;
    }
    const ofEntry = draftsByEntry.get(entryId) ?? [];
    const head =
      ofEntry.find((draft) => draft.locale === locale) ??
      ofEntry.find((draft) => draft.locale === context.snapshot.defaultLocale) ??
      ofEntry[0];
    const value = head?.data?.[field.id];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  return {
    entryTitle: (row: OpenFindingRow) => titleOf(row.entry_id, readable.get(row.model_id), row.locale),
    /** The linked entry's title, when it is a live entry of this site the caller may read. */
    targetTitle: (row: OpenFindingRow): string | null => {
      const target = targetById.get(targetIdOf(row) ?? '');
      const model = target ? readable.get(target.model_id) : undefined;
      if (
        !target ||
        !model ||
        target.deleted_at !== null ||
        target.site_id !== context.site.id ||
        !matchesRowFilter(model.policy.rowFilter, context.actor, target)
      ) {
        return null;
      }
      return titleOf(target.id, model, row.locale);
    },
  };
};

/** Open findings, newest first, one page at a time. */
export const listFindings = async (context: ContentServiceContext, query: FindingsQuery) => {
  const everyReadable = await readableModels(context);
  const readable = withModelKey(everyReadable, query.modelKey);
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 200);
  const after = decodeCursor(query.cursor);
  const rows = await contentHealthFindingsRepository.listOpen(
    {
      siteId: context.site.id,
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
  const titles = await titlesFor(context, visible, everyReadable);
  const last = rows.at(-1);
  return {
    items: visible.map((row): FindingView => {
      const targetTitle = titles.targetTitle(row);
      return {
        id: row.id,
        entryId: row.entry_id,
        modelId: row.model_id,
        modelKey: readable.get(row.model_id)?.definition.apiKey ?? '',
        entryTitle: titles.entryTitle(row),
        locale: row.locale,
        rule: row.rule as HealthRule,
        subject: row.subject,
        severity: row.severity as FindingView['severity'],
        ...(row.path ? { path: row.path } : {}),
        params: row.details as FindingView['params'],
        ...(targetTitle === null ? {} : { targetTitle }),
        firstSeenAt: row.first_seen_at.toISOString(),
        lastSeenAt: row.last_seen_at.toISOString(),
      };
    }),
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
    context.site.id,
    unfiltered.map((model) => model.definition.id),
    context.db,
  )) {
    add(row.rule, Number(row.count));
  }
  for (const model of filtered) {
    const rows = await contentHealthFindingsRepository.listOpen(
      { siteId: context.site.id, modelIds: [model.definition.id], limit: 10_000 },
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
