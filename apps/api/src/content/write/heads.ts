import type { Transaction } from 'kysely';
import type { ContentData } from '../../db/contentData.js';
import type { DB } from '../../db/types.js';
import type { Principal } from '../../permissions/types.js';
import * as contentRevisionsRepository from '../../repositories/contentRevisions.js';
import type { RevisionReason } from '../../repositories/contentRevisions.js';
import * as entriesRepository from '../../repositories/entries.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { HeadRecord } from '../../repositories/entryHeads.js';
import * as publicationsRepository from '../../repositories/publications.js';
import * as relationEdgesRepository from '../../repositories/relationEdges.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import { actorColumns } from '../../schema/planner/actor.js';
import * as mediaReferencesService from '../../services/mediaReferences.js';
import { mediaUsesOf } from '../media.js';
import { SHARED_LOCALE, type ContentModel } from '../model.js';
import { edgesOf } from '../relations.js';
import { syncUniqueValues, uniqueFields } from '../unique.js';

/**
 * Head-moving primitives shared by every content write. Each runs inside the caller's transaction (see
 * `runEntryWrite`); revisions, heads, relation edges and the publication log move together.
 */
export type WriteContext = {
  trx: Transaction<DB>;
  /** The entry's site (sites plan §H): relation and media targets must be on it. */
  siteId: string;
  model: ContentModel;
  actor: Principal;
  now: Date;
};

/** Relation edges and media references of one head, derived from its data (same transaction). */
export const syncHeadDerivations = async (
  context: WriteContext,
  head: { entryId: string; locale: string; state: 'draft' | 'published' },
  data: ContentData,
) => {
  await relationEdgesRepository.replaceForHead(head, edgesOf(context.model, data), context.trx);
  await mediaReferencesService.replaceHeadReferences(
    context.trx,
    head,
    mediaUsesOf(context.model, data).map((use) => ({ ...use, modelId: context.model.definition.id })),
  );
};

export type DraftWrite = {
  entryId: string;
  locale: string;
  data: ContentData;
  /** The current draft head of this locale, if any. */
  previous: HeadRecord | undefined;
  /**
   * `revision`: an explicit save (new immutable revision). `autosave`: only the head moves.
   * `lenient`: a revision is written but the draft is flagged as not fully validated (duplicates).
   */
  mode: 'revision' | 'autosave' | 'lenient';
  reason: RevisionReason;
};

const insertRevision = (
  context: WriteContext,
  input: {
    entryId: string;
    locale: string;
    data: ContentData;
    reason: RevisionReason;
    parentRevisionId: string | null;
  },
) => {
  const author = actorColumns(context.actor);
  return contentRevisionsRepository.insert(
    {
      entryId: input.entryId,
      locale: input.locale,
      schemaRevisionId: context.model.revisionId,
      data: input.data,
      reason: input.reason,
      authorType: author.type,
      authorId: author.id,
      parentRevisionId: input.parentRevisionId,
    },
    context.trx,
  );
};

/** Writes a locale's draft head (and, unless autosaving, a revision), then its relation edges. */
export const writeDraft = async (context: WriteContext, write: DraftWrite): Promise<HeadRecord> => {
  const { entryId, locale, data, previous, mode, reason } = write;
  let revisionId = previous?.revision_id;
  if (mode !== 'autosave' || !revisionId) {
    const revision = await insertRevision(context, {
      entryId,
      locale,
      data,
      reason,
      parentRevisionId: previous?.revision_id ?? null,
    });
    revisionId = revision.id;
  }
  const head = {
    entryId,
    modelId: context.model.definition.id,
    locale,
    state: 'draft' as const,
    revisionId,
    data,
    autosavedAt: mode === 'revision' ? null : context.now,
    now: context.now,
  };
  const written = previous
    ? await entryHeadsRepository.update(head, context.trx)
    : await entryHeadsRepository.insert(head, context.trx);
  await syncHeadDerivations(context, { entryId, locale, state: 'draft' }, data);
  return written;
};

/**
 * Publishes one locale's draft (ADR 0004: strictly per locale). Autosaved changes get a revision first, so
 * the published head always points at an immutable revision with exactly its data. Returns the revision ID.
 */
export const publishDraft = async (
  context: WriteContext,
  input: { draft: HeadRecord; published: HeadRecord | undefined; seq: number },
): Promise<string> => {
  const { draft, published, seq } = input;
  let revisionId = draft.revision_id;
  if (draft.autosaved_at) {
    const revision = await insertRevision(context, {
      entryId: draft.entry_id,
      locale: draft.locale,
      data: draft.data,
      reason: 'publish',
      parentRevisionId: draft.revision_id,
    });
    revisionId = revision.id;
    await entryHeadsRepository.update(
      {
        entryId: draft.entry_id,
        modelId: draft.model_id,
        locale: draft.locale,
        state: 'draft',
        revisionId,
        data: draft.data,
        autosavedAt: null,
        now: context.now,
      },
      context.trx,
    );
  }
  await movePublishedHead(context, {
    entryId: draft.entry_id,
    locale: draft.locale,
    revisionId,
    data: draft.data,
    published,
    seq,
  });
  return revisionId;
};

/** Points (entry, locale)'s published head at a revision and rolls its publication-log row at `seq`. */
const movePublishedHead = async (
  context: WriteContext,
  input: {
    entryId: string;
    locale: string;
    revisionId: string;
    data: ContentData;
    published: HeadRecord | undefined;
    seq: number;
  },
) => {
  const { entryId, locale, revisionId, data, seq } = input;
  const modelId = context.model.definition.id;
  const head = {
    entryId,
    modelId,
    locale,
    state: 'published' as const,
    revisionId,
    data,
    autosavedAt: null,
    now: context.now,
  };
  if (input.published) {
    await entryHeadsRepository.update(head, context.trx);
  } else {
    await entryHeadsRepository.insert(head, context.trx);
  }
  await syncHeadDerivations(context, { entryId, locale, state: 'published' }, data);
  await publicationsRepository.close(entryId, locale, seq, context.trx);
  await publicationsRepository.open(
    { entryId, modelId, locale, revisionId, seq, now: context.now },
    context.trx,
  );
};

/**
 * Publishes an earlier revision's (validated) data as it was, leaving the draft head alone (restore to a
 * snapshot): a new `restore` revision whose parent is the source, so history stays exact. Returns its ID.
 */
export const publishRevision = async (
  context: WriteContext,
  input: {
    entryId: string;
    locale: string;
    sourceRevisionId: string;
    data: ContentData;
    published: HeadRecord | undefined;
    seq: number;
  },
): Promise<string> => {
  const revision = await insertRevision(context, {
    entryId: input.entryId,
    locale: input.locale,
    data: input.data,
    reason: 'restore',
    parentRevisionId: input.sourceRevisionId,
  });
  await movePublishedHead(context, { ...input, revisionId: revision.id });
  return revision.id;
};

/** Takes one locale offline (its edges go with the head). */
export const unpublishLocale = async (
  context: WriteContext,
  entryId: string,
  locale: string,
  seq: number,
) => {
  await entryHeadsRepository.remove(entryId, locale, 'published', context.trx);
  await releasePublishedClaims(context, entryId, locale);
  await mediaReferencesService.removeReferences(context.trx, { entryId, locale, state: 'published' });
  await publicationsRepository.close(entryId, locale, seq, context.trx);
};

/**
 * Drops the entry's published-state unique claims for `locale`, and its shared (`*`) ones once no locale is
 * live, whatever the active schema says is unique: a pending change's dry run may have staged claims for a
 * field that only becomes unique at activation, and the activation re-checks changed heads, never removed
 * ones. `syncEntryUniqueValues` re-adds whatever is still owed.
 */
const releasePublishedClaims = async (context: WriteContext, entryId: string, locale: string) => {
  await uniqueValuesRepository.removeForEntryState(entryId, 'published', locale, context.trx);
  const heads = await entryHeadsRepository.findForEntry(entryId, context.trx);
  if (!heads.some((head) => head.state === 'published')) {
    await uniqueValuesRepository.removeForEntryState(entryId, 'published', SHARED_LOCALE, context.trx);
  }
};

/** Re-derives the entry's unique-registry rows from its heads as they are now. */
export const syncEntryUniqueValues = async (context: WriteContext, entryId: string) => {
  const fields = uniqueFields(context.model.definition);
  if (fields.length === 0) {
    return;
  }
  const heads = await entryHeadsRepository.findForEntry(entryId, context.trx);
  await syncUniqueValues(context.trx, { entryId, model: context.model.definition, fields, heads });
};

export const touchEntry = (context: WriteContext, entryId: string) =>
  entriesRepository.touch(entryId, context.now, context.trx);
