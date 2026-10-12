import {
  contentVersionConflict,
  entryLocaleNotFound,
  invalidExpectedVersion,
  publishingDisabled,
} from '../content/errors.js';
import type { ContentHooks } from '../content/hooks.js';
import { writeLocaleFor } from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import { validateRevisionData } from '../content/revisionData.js';
import { buildValidator } from '../content/validator/index.js';
import { contentInvalid } from '../content/validator/issues.js';
import {
  publishDraft,
  publishRevision,
  syncEntryUniqueValues,
  touchEntry,
  unpublishLocale,
  type WriteContext,
} from '../content/write/heads.js';
import { assertTargets, mediaIdsOf } from '../content/write/references.js';
import { runEntryWrite } from '../content/write/transaction.js';
import type { ContentData } from '../db/contentData.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import { createSeqAllocator, type SeqAllocator } from '../repositories/publications.js';
import { actorColumns } from '../schema/planner/actor.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { SiteRef } from './actorContext.js';
import {
  assertEntryVisible,
  auditEntry,
  modelWithPolicy,
  writeEntryEvent,
  type ContentServiceContext,
} from './contentAccess.js';
import { statusOf, viewAfterWrite, type AdminEntryView } from './contentReads.js';

/**
 * Publishing (ADR 0004: strictly per locale). Publishing a locale validates its draft against the current
 * schema, points the published head at an immutable revision, records the publication sequence for
 * `?snapshot=`, and writes the outbox event, all in one transaction (brief §7).
 */
export type PublishTransaction = {
  write: WriteContext;
  /** The site published on (lifecycle hooks are told about it). */
  site: SiteRef;
  snapshot: SchemaSnapshot;
  hooks: ContentHooks;
  /** The transaction's one publication sequence number (shared by a whole batch). */
  seq: SeqAllocator;
};

export type PublishedLocale = { locale: string; revisionId: string; snapshot: number };

/**
 * Publishes the given locales of a locked entry. One publication sequence number covers them all. A locale
 * whose draft is already live is left alone and not in the result.
 */
export const publishLocalesInTransaction = async (
  tx: PublishTransaction,
  entryId: string,
  locales: readonly string[],
  heads: readonly HeadRecord[],
): Promise<PublishedLocale[]> => {
  const { write, snapshot, hooks, site } = tx;
  const { model, trx, actor } = write;
  const validator = buildValidator(snapshot, model);
  const drafts = heads.filter((head) => head.state === 'draft');
  const results: PublishedLocale[] = [];
  for (const locale of locales) {
    const draft = drafts.find((head) => head.locale === locale);
    if (!draft) {
      throw entryLocaleNotFound(
        entryId,
        locale,
        drafts.map((head) => head.locale),
      );
    }
    const published = heads.find((head) => head.state === 'published' && head.locale === locale);
    if (statusOf(draft, published) === 'published') {
      // The draft is already live: nothing to publish, so no snapshot, event or publication-log row.
      continue;
    }
    const outcome = validator.validate(draft.data);
    if (outcome.issues.length > 0) {
      throw contentInvalid(
        outcome.issues.map((issue) => ({ ...issue, message: `${issue.message} (${locale})` })),
      );
    }
    // Every asset of a saved draft passed the check when it was saved; one gone since was force-deleted.
    await assertTargets(trx, outcome, site.id, mediaIdsOf(model, [draft.data]));
    const context = {
      trx,
      site,
      model,
      entryId,
      locale,
      data: outcome.data,
      ...(published ? { before: published.data } : {}),
      actor,
    };
    await hooks.run('beforePublish', context);
    const seq = await tx.seq.next();
    const revisionId = await publishDraft(write, { draft: { ...draft, data: outcome.data }, published, seq });
    await hooks.run('afterPublish', context);
    await writeEntryEvent(trx, site.id, model, 'entry.published', entryId, {
      locale,
      revisionId,
      snapshot: seq,
    });
    results.push({ locale, revisionId, snapshot: seq });
  }
  return results;
};

/**
 * Publishes an earlier revision of one locale (restore to a snapshot): validated against the current schema
 * like a draft, then published as a new `restore` revision. The draft head is left as it is.
 */
export const publishRevisionInTransaction = async (
  tx: PublishTransaction,
  entryId: string,
  locale: string,
  source: { id: string; data: ContentData },
  heads: readonly HeadRecord[],
): Promise<PublishedLocale> => {
  const { write, snapshot, hooks, site } = tx;
  const { model, trx, actor } = write;
  const outcome = validateRevisionData(buildValidator(snapshot, model), source.data);
  if (outcome.issues.length > 0) {
    throw contentInvalid(
      outcome.issues.map((issue) => ({ ...issue, message: `${issue.message} (${locale})` })),
    );
  }
  await assertTargets(
    trx,
    outcome,
    site.id,
    mediaIdsOf(
      model,
      heads.filter((head) => head.locale === locale).map((head) => head.data),
    ),
  );
  const published = heads.find((head) => head.state === 'published' && head.locale === locale);
  const context = {
    trx,
    site,
    model,
    entryId,
    locale,
    data: outcome.data,
    ...(published ? { before: published.data } : {}),
    actor,
  };
  await hooks.run('beforePublish', context);
  const seq = await tx.seq.next();
  const revisionId = await publishRevision(write, {
    entryId,
    locale,
    sourceRevisionId: source.id,
    data: outcome.data,
    published,
    seq,
  });
  await hooks.run('afterPublish', context);
  await writeEntryEvent(trx, site.id, model, 'entry.published', entryId, {
    locale,
    revisionId,
    snapshot: seq,
  });
  return { locale, revisionId, snapshot: seq };
};

/** The locales a publish request acts on: the requested ones (or the default), or the only one. */
export const targetLocales = (
  context: ContentServiceContext,
  model: ContentModel,
  requested: readonly string[] | undefined,
  heads: readonly HeadRecord[],
) => {
  if (!model.definition.localized) {
    // A non-localized entry has exactly one locale's heads.
    return [...new Set(heads.filter((head) => head.state === 'draft').map((head) => head.locale))];
  }
  return [
    ...new Set(
      (requested?.length ? requested : [undefined]).map((locale) =>
        writeLocaleFor(context.snapshot, model.definition, locale),
      ),
    ),
  ];
};

type LocalesInput = { locales?: string[] };

/** A publish request: the locales, and optionally the draft version(s) the caller saw. */
export type PublishInput = LocalesInput & {
  expectedVersion?: number;
  expectedVersions?: Record<string, number>;
};

/** Each published locale's draft version, from either form of the request; empty when it names none. */
const expectedVersionsOf = (input: PublishInput, locales: readonly string[]): Map<string, number> => {
  if (input.expectedVersion !== undefined && input.expectedVersions !== undefined) {
    throw invalidExpectedVersion('Send expectedVersion or expectedVersions, not both', {});
  }
  if (input.expectedVersion !== undefined) {
    if (locales.length !== 1) {
      throw invalidExpectedVersion(
        'expectedVersion is for a publish of one locale; send expectedVersions for several',
        { locales },
      );
    }
    return new Map([[locales[0] as string, input.expectedVersion]]);
  }
  const entries = Object.entries(input.expectedVersions ?? {});
  const unknown = entries.filter(([locale]) => !locales.includes(locale)).map(([locale]) => locale);
  if (unknown.length > 0) {
    throw invalidExpectedVersion('expectedVersions names locales this request does not publish', {
      locales: unknown,
    });
  }
  return new Map(entries);
};

/** Refuses a publish whose caller saw an older draft than the one that would go live (optimistic concurrency). */
const assertExpectedVersions = (
  input: PublishInput,
  locales: readonly string[],
  heads: readonly HeadRecord[],
) => {
  for (const [locale, expected] of expectedVersionsOf(input, locales)) {
    const draft = heads.find((head) => head.state === 'draft' && head.locale === locale);
    if (draft && draft.version !== expected) {
      throw contentVersionConflict(expected, draft.version);
    }
  }
};

const changePublication = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: PublishInput,
  operation: 'publish' | 'unpublish',
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'publish');
  if (!model.definition.draftAndPublish) {
    throw publishingDisabled(modelKey);
  }
  const lockedLocales = model.definition.localized ? targetLocales(context, model, input.locales, []) : [];
  await runEntryWrite(context.db, model, context.site.id, lockedLocales, async (trx) => {
    const write: WriteContext = {
      trx,
      siteId: context.site.id,
      model,
      actor: context.actor,
      now: new Date(),
    };
    assertEntryVisible(
      policy,
      context.actor,
      await entriesRepository.lockLive(id, model.definition.id, context.site.id, trx),
      id,
    );
    const heads = await entryHeadsRepository.lockForEntry(id, trx);
    const locales = targetLocales(context, model, input.locales, heads);
    let metadata: Record<string, unknown>;
    const seqs = createSeqAllocator(trx, context.site.id, {
      source: operation,
      actor: actorColumns(context.actor),
    });
    if (operation === 'publish') {
      assertExpectedVersions(input, locales, heads);
      const published = await publishLocalesInTransaction(
        { write, site: context.site, snapshot: context.snapshot, hooks: context.hooks, seq: seqs },
        id,
        locales,
        heads,
      );
      metadata = {
        locales: published.map((item) => item.locale),
        snapshot: published[0]?.snapshot ?? null,
        revisions: published.map((item) => item.revisionId),
      };
    } else {
      const live = locales.filter((locale) =>
        heads.some((head) => head.state === 'published' && head.locale === locale),
      );
      const seq = live.length > 0 ? await seqs.next() : null;
      for (const locale of live) {
        await unpublishLocale(write, id, locale, seq as number);
        await writeEntryEvent(trx, context.site.id, model, 'entry.unpublished', id, {
          locale,
          snapshot: seq,
        });
      }
      metadata = { locales: live, snapshot: seq };
    }
    await syncEntryUniqueValues(write, id);
    await touchEntry(write, id);
    await auditEntry(trx, context, model, `content.${operation}`, id, metadata);
  });
  return viewAfterWrite(context, model, policy, id, input.locales?.[0]);
};

/** Publishes one or more locales of an entry ("publish the other outdated locales too" is one call). */
export const publishEntry = (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: PublishInput,
) => changePublication(context, modelKey, id, input, 'publish');

export const unpublishEntry = (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: LocalesInput,
) => changePublication(context, modelKey, id, input, 'unpublish');
