import { RESTORE_MAX_ITEMS } from '../constants/publishing.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import { findPublishedUniqueConflicts } from '../content/unique.js';
import { buildValidator } from '../content/validator/index.js';
import { AppError } from '../helpers/appError.js';
import { adminIdOf, tokenIdOf } from '../publishing/principals.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as publicationsRepository from '../repositories/publications.js';
import {
  listChanges,
  type SnapshotEntryChange,
  type SnapshotLocaleChange,
} from '../repositories/snapshotDiff.js';
import { auditChangeSet, getChangeSet, type ChangeSetServiceContext } from './changeSets.js';
import type { ChangeSetView } from './changeSetViews.js';

/**
 * Restore to snapshot N (developer-face plan §5, feature 6): a new, reviewable change set that brings live
 * content back to what N served. Nothing is deleted and nothing goes live until the set ships, as a new
 * snapshot. Entries live now but not at N are unpublished; entries changed or unpublished since N publish
 * the revision N served (`publishRevision`, the draft is left alone). Schema is not rolled back. Entries
 * that cannot be restored are listed on the set (the review shows them), never skipped silently.
 */
type Reason =
  | 'entry_deleted'
  | 'model_missing'
  | 'publishing_disabled'
  | 'localization_changed'
  | 'locale_missing'
  | 'invalid'
  | 'unique_conflict';

export type NotRestorable = {
  entryId: string;
  modelId: string;
  modelKey: string | null;
  locale: string;
  reason: Reason;
  detail: string;
};

type RestoreItem = {
  entryId: string;
  modelId: string;
  locale: string;
  action: 'publish' | 'unpublish';
  sourceRevisionId: string | null;
};

const DIFF_PAGE = 500;

const snapshotNotFound = (seq: number) =>
  new AppError(404, 'SNAPSHOT_NOT_FOUND', `There is no snapshot ${seq}`, { seq });

/** Every (entry, locale) whose live content differs between `from` and `to`. */
const collectChanges = async (context: ChangeSetServiceContext, from: number, to: number) => {
  const changes: SnapshotEntryChange[] = [];
  let after: string | undefined;
  let total = 0;
  do {
    const page = await listChanges({ from, to, after, limit: DIFF_PAGE, modelIds: null }, context.db);
    changes.push(...page.items);
    total += page.items.reduce((sum, item) => sum + item.locales.length, 0);
    if (total > RESTORE_MAX_ITEMS) {
      throw new AppError(
        422,
        'CHANGE_SET_TOO_LARGE',
        `Restoring snapshot ${from} would change more than ${RESTORE_MAX_ITEMS} entries; restore a newer snapshot`,
        { limit: RESTORE_MAX_ITEMS },
      );
    }
    after = page.nextAfter ?? undefined;
  } while (after !== undefined);
  return changes;
};

type Check = { item?: RestoreItem; blocked?: NotRestorable };

const blockedBy = (
  change: SnapshotEntryChange,
  locale: string,
  model: ContentModel | undefined,
  reason: Reason,
  detail: string,
): Check => ({
  blocked: {
    entryId: change.entryId,
    modelId: change.modelId,
    modelKey: model?.definition.apiKey ?? null,
    locale,
    reason,
    detail,
  },
});

/** Checks that restoring this locale can work against the current schema and content. */
const checkLocale = async (
  context: ChangeSetServiceContext,
  change: SnapshotEntryChange,
  localeChange: SnapshotLocaleChange,
  liveEntries: ReadonlySet<string>,
): Promise<Check> => {
  const { locale } = localeChange;
  const model = resolveModelById(context.snapshot, change.modelId);
  if (!model) {
    return blockedBy(change, locale, model, 'model_missing', 'The model no longer exists');
  }
  if (!model.definition.draftAndPublish) {
    return blockedBy(
      change,
      locale,
      model,
      'publishing_disabled',
      'The model no longer has drafts and publishing',
    );
  }
  if (!liveEntries.has(change.entryId)) {
    return blockedBy(change, locale, model, 'entry_deleted', 'The entry was deleted since');
  }
  if (localeChange.change === 'published') {
    return {
      item: {
        entryId: change.entryId,
        modelId: change.modelId,
        locale,
        action: 'unpublish',
        sourceRevisionId: null,
      },
    };
  }
  if (!context.snapshot.locales.some((candidate) => candidate.code === locale)) {
    return blockedBy(change, locale, model, 'locale_missing', `The locale ${locale} was removed`);
  }
  if (!model.definition.localized && locale !== context.snapshot.defaultLocale) {
    const heads = await changeSetItemsRepository.findHeadsForEntries([change.entryId], context.db);
    if (heads.length > 0 && !heads.some((head) => head.locale === locale)) {
      return blockedBy(
        change,
        locale,
        model,
        'localization_changed',
        'The model stopped being localized since',
      );
    }
  }
  const revision = await contentRevisionsRepository.findById(localeChange.fromRevisionId ?? '', context.db);
  if (!revision) {
    return blockedBy(change, locale, model, 'invalid', 'The revision served then is missing');
  }
  const outcome = buildValidator(context.snapshot, model).validate(revision.data);
  if (outcome.issues.length > 0) {
    const first = outcome.issues[0];
    return blockedBy(
      change,
      locale,
      model,
      'invalid',
      `It no longer fits the model: ${first?.path ?? ''} ${first?.message ?? ''}`.trim(),
    );
  }
  const conflicts = await findPublishedUniqueConflicts(context.db, {
    entryId: change.entryId,
    model: model.definition,
    drafts: [{ locale, data: outcome.data }],
  });
  if (conflicts.length > 0) {
    const field = model.definition.fields.find((candidate) => candidate.id === conflicts[0]?.fieldId);
    return blockedBy(
      change,
      locale,
      model,
      'unique_conflict',
      `Another entry now uses its ${field?.apiKey ?? 'unique'} value`,
    );
  }
  return {
    item: {
      entryId: change.entryId,
      modelId: change.modelId,
      locale,
      action: 'publish',
      sourceRevisionId: revision.id,
    },
  };
};

export const restoreSnapshot = async (
  context: ChangeSetServiceContext,
  seq: number,
): Promise<ChangeSetView> => {
  const current = await publicationsRepository.currentSeq(context.db);
  if (seq > current) {
    throw snapshotNotFound(seq);
  }
  if (seq === current) {
    throw new AppError(
      409,
      'SNAPSHOT_IS_CURRENT',
      `Snapshot ${seq} is the live snapshot; there is nothing to restore`,
    );
  }
  const changes = await collectChanges(context, seq, current);
  const liveEntries = new Set(
    await changeSetItemsRepository.findLiveEntryIds(
      changes.map((change) => change.entryId),
      context.db,
    ),
  );
  const items: RestoreItem[] = [];
  const blocked: NotRestorable[] = [];
  for (const change of changes) {
    for (const localeChange of change.locales) {
      const check = await checkLocale(context, change, localeChange, liveEntries);
      if (check.item) {
        items.push(check.item);
      }
      if (check.blocked) {
        blocked.push(check.blocked);
      }
    }
  }
  const id = await context.db.transaction().execute(async (trx) => {
    const row = await changeSetsRepository.insert(
      {
        title: `Restore snapshot ${seq}`,
        description: `Brings live content back to what snapshot ${seq} served. The schema is not rolled back.`,
        source: 'restore',
        restore_of_seq: String(seq),
        restore_report: JSON.stringify(blocked),
        created_by: adminIdOf(context.actor),
        created_by_token: tokenIdOf(context.actor),
      },
      trx,
    );
    await changeSetItemsRepository.insertEntryItems(row.id, items, trx);
    await auditChangeSet(trx, context, row.id, 'change_set.create', {
      title: row.title,
      restoreOf: seq,
      items: items.length,
      notRestorable: blocked.length,
    });
    return row.id;
  });
  return getChangeSet(context, id);
};
