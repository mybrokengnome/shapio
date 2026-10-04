import type { Transaction } from 'kysely';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import { AppError } from '../../helpers/appError.js';
import type { Principal } from '../../permissions/types.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import * as publicationsRepository from '../../repositories/publications.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import type { TargetHeadRow } from '../../repositories/transferImport.js';
import type { SchemaSnapshot } from '../../schema/snapshot.js';
import * as mediaReferencesService from '../../services/mediaReferences.js';
import { resolveModelById, type ContentModel } from '../model.js';
import { buildValidator } from '../validator/index.js';
import { contentInvalid } from '../validator/issues.js';
import { syncEntryUniqueValues, syncHeadDerivations, type WriteContext } from '../write/heads.js';
import { assertTargets } from '../write/references.js';
import { runEntryWrite } from '../write/transaction.js';
import { classifyEntry } from './classify.js';
import type { EntryRecord, HeadRecordInBundle } from './format.js';

/**
 * Imports one bundle entry in one transaction under the transitional write policy (ADR 0002): revisions
 * with their IDs, then every head exactly as exported, with relation edges, media references, the unique
 * registry and the publication log maintained by the same primitives as any save or publish. Heads are
 * validated against the target's active model first (the bundle is untrusted input); a conflicting or
 * invalid entry throws an AppError and nothing of it is written.
 */
export type EntryOutcome = 'added' | 'updated' | 'unchanged';

export const entryConflict = (entryId: string, reason: string, detail?: string) =>
  new AppError(409, 'TRANSFER_ENTRY_CONFLICT', detail ?? reason, { entryId, reason });

const unknownModel = (entry: EntryRecord) =>
  new AppError(422, 'TRANSFER_UNKNOWN_MODEL', `Model ${entry.modelId} does not exist on the target`, {
    entryId: entry.id,
  });

const headKey = (head: { locale: string; state: string }) => `${head.locale}:${head.state}`;

/** Validates every head (drafts may lack required values, like an autosave) and collects their targets. */
const validateHeads = (snapshot: SchemaSnapshot, model: ContentModel, entry: EntryRecord) => {
  const validator = buildValidator(snapshot, model);
  return entry.heads.map((head) => {
    const outcome = validator.validate(head.data, { skipRequired: head.state === 'draft' });
    if (outcome.issues.length > 0) {
      throw contentInvalid(
        outcome.issues.map((issue) => ({ ...issue, path: `/${head.locale}/${head.state}${issue.path}` })),
      );
    }
    return { head, outcome };
  });
};

const writeRevisions = async (trx: Transaction<DB>, model: ContentModel, entry: EntryRecord) => {
  for (const revision of entry.revisions) {
    await transferImportRepository.insertRevision(
      {
        id: revision.id,
        entryId: entry.id,
        locale: revision.locale,
        // History keeps its data; its schema provenance on this instance is the model's active revision.
        schemaRevisionId: model.revisionId,
        data: revision.data,
        reason: revision.reason,
        parentRevisionId: revision.parentRevisionId,
        createdAt: revision.createdAt,
      },
      trx,
    );
  }
};

type PublicationStep = { siteId: string; seq: number | undefined };

const nextSeqOnce = async (trx: Transaction<DB>, step: PublicationStep) => {
  step.seq ??= await publicationsRepository.nextSeq(trx, step.siteId, { source: 'import' });
  return step.seq;
};

const writeHead = async (
  write: WriteContext,
  entry: EntryRecord,
  head: HeadRecordInBundle,
  data: Record<string, unknown>,
  existing: TargetHeadRow | undefined,
  step: PublicationStep,
) => {
  const record = {
    entryId: entry.id,
    modelId: entry.modelId,
    locale: head.locale,
    state: head.state,
    revisionId: head.revisionId,
    data,
    autosavedAt: head.autosavedAt,
    version: head.version,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
  };
  if (existing) {
    await transferImportRepository.moveHead(record, write.trx);
  } else {
    await transferImportRepository.insertHead(record, write.trx);
  }
  await syncHeadDerivations(write, { entryId: entry.id, locale: head.locale, state: head.state }, data);
  if (head.state === 'published' && existing?.revision_id !== head.revisionId) {
    const seq = await nextSeqOnce(write.trx, step);
    await publicationsRepository.close(entry.id, head.locale, seq, write.trx);
    await publicationsRepository.open(
      {
        entryId: entry.id,
        modelId: entry.modelId,
        locale: head.locale,
        revisionId: head.revisionId,
        seq,
        now: new Date(head.publishedAt ?? head.updatedAt),
      },
      write.trx,
    );
  }
};

/** Heads the target has and the bundle does not (a fast-forward to an unpublished or removed locale). */
const removeHead = async (
  write: WriteContext,
  entryId: string,
  head: TargetHeadRow,
  step: PublicationStep,
) => {
  const state = head.state as 'draft' | 'published';
  await entryHeadsRepository.remove(entryId, head.locale, state, write.trx);
  await mediaReferencesService.removeReferences(write.trx, { entryId, locale: head.locale, state });
  if (state === 'published') {
    await publicationsRepository.close(entryId, head.locale, await nextSeqOnce(write.trx, step), write.trx);
  }
};

export type EntryImportContext = { db: Database; actor: Principal; siteId: string };

export const importEntry = async (
  context: EntryImportContext,
  snapshot: SchemaSnapshot,
  entry: EntryRecord,
): Promise<EntryOutcome> => {
  const model = resolveModelById(snapshot, entry.modelId);
  if (!model) {
    throw unknownModel(entry);
  }
  const validated = validateHeads(snapshot, model, entry);
  const locales = [...new Set(entry.heads.map((head) => head.locale))];
  return runEntryWrite(context.db, model, context.siteId, locales, async (trx) => {
    const write: WriteContext = { trx, siteId: context.siteId, model, actor: context.actor, now: new Date() };
    let target = await transferImportRepository.lockEntry(entry.id, trx);
    if (!target) {
      // Normally created by the job's entries pass (with its owner); this covers a single-entry retry.
      await transferImportRepository.insertEntries(context.siteId, [{ ...entry, ownerAppUserId: null }], trx);
      target = await transferImportRepository.lockEntry(entry.id, trx);
    }
    const heads = await transferImportRepository.lockHeads(entry.id, trx);
    const classification = classifyEntry(entry, target, heads);
    if (classification.kind === 'conflict') {
      throw entryConflict(entry.id, classification.reason, classification.detail);
    }
    if (classification.kind === 'unchanged') {
      return 'unchanged';
    }
    await assertTargets(
      trx,
      {
        relations: validated.flatMap(({ outcome }) => outcome.relations),
        media: validated.flatMap(({ outcome }) => outcome.media),
      },
      context.siteId,
    );
    await writeRevisions(trx, model, entry);
    const existing = new Map(heads.map((head) => [headKey(head), head]));
    const step: PublicationStep = { siteId: context.siteId, seq: undefined };
    for (const { head, outcome } of validated) {
      const current = existing.get(headKey(head));
      existing.delete(headKey(head));
      if (
        current?.revision_id === head.revisionId &&
        (current.autosaved_at === null) === (head.autosavedAt === null)
      ) {
        // Same revision: only autosaved data could differ, and classify() allowed that only when equal.
        continue;
      }
      await writeHead(write, entry, head, outcome.data, current, step);
    }
    for (const leftover of existing.values()) {
      await removeHead(write, entry.id, leftover, step);
    }
    await syncEntryUniqueValues(write, entry.id);
    await transferImportRepository.setEntryUpdatedAt(entry.id, entry.updatedAt, trx);
    return heads.length === 0 ? 'added' : 'updated';
  });
};
