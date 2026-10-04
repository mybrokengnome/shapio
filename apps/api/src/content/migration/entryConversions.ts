import type { SchemaChange } from '@shapio/schema';
import type { Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as entriesRepository from '../../repositories/entries.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { HeadRecord } from '../../repositories/entryHeads.js';
import * as publicationsRepository from '../../repositories/publications.js';
import type { SeqAllocator } from '../../repositories/publications.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import type { SchemaById } from '../../schema/snapshot.js';
import * as mediaReferencesService from '../../services/mediaReferences.js';
import { resolveModelById } from '../model.js';
import { publishDraft, syncEntryUniqueValues, type WriteContext } from '../write/heads.js';
import { draftsOf, primaryLocale, unifiedData, unpublishedDrafts } from './propose.js';

/**
 * Conversions that work on a whole entry across its locales or states rather than value by value
 * (ADR 0002/0004): a field or model that stops being localized, and a model that stops having drafts.
 * Each runs in the activation transaction (ADR 0002 pipeline) with the entry row locked; propose.ts computes
 * the same result in memory for the dry run.
 */
const SYSTEM_ACTOR = { kind: 'system', component: 'schema-convert' } as const;

/** A field becomes shared: every draft takes the primary locale's value. Published heads stay as published. */
const unifyField = async (
  trx: Transaction<DB>,
  heads: readonly HeadRecord[],
  fieldId: string,
  defaultLocale: string,
) => {
  const primary = draftsOf(heads).find((head) => head.locale === primaryLocale(heads, defaultLocale));
  for (const draft of draftsOf(heads)) {
    const data = unifiedData(draft, primary, fieldId);
    if (!data) {
      continue;
    }
    await entryHeadsRepository.rewriteData(
      { entryId: draft.entry_id, locale: draft.locale, state: 'draft', changeSeq: draft.change_seq },
      data,
      trx,
    );
  }
};

/** A model stops being localized: the entry keeps one locale's heads; the others are taken offline and removed. */
const keepOneLocale = async (
  trx: Transaction<DB>,
  nextSeq: SeqAllocator,
  entryId: string,
  heads: readonly HeadRecord[],
  defaultLocale: string,
) => {
  const keep = primaryLocale(heads, defaultLocale);
  const removed = [...new Set(heads.map((head) => head.locale))].filter((locale) => locale !== keep);
  const wasLive = heads.some((head) => head.state === 'published' && removed.includes(head.locale));
  const seq = wasLive ? await nextSeq.next() : null;
  for (const locale of removed) {
    for (const state of ['draft', 'published'] as const) {
      await entryHeadsRepository.remove(entryId, locale, state, trx);
      await uniqueValuesRepository.removeForEntryState(entryId, state, locale, trx);
    }
    await mediaReferencesService.removeReferences(trx, { entryId, locale });
    if (seq !== null) {
      await publicationsRepository.close(entryId, locale, seq, trx);
    }
  }
};

/** A model stops having drafts: every locale's draft is published as it is. */
const publishAll = async (
  trx: Transaction<DB>,
  nextSeq: SeqAllocator,
  proposed: SchemaById,
  entry: { id: string; siteId: string; modelId: string },
  heads: readonly HeadRecord[],
) => {
  const model = resolveModelById(proposed, entry.modelId);
  const pending = unpublishedDrafts(heads);
  if (!model || pending.length === 0) {
    return;
  }
  const write: WriteContext = { trx, siteId: entry.siteId, model, actor: SYSTEM_ACTOR, now: new Date() };
  const seq = await nextSeq.next();
  for (const draft of pending) {
    const published = heads.find((head) => head.state === 'published' && head.locale === draft.locale);
    await publishDraft(write, { draft, published, seq });
  }
  await syncEntryUniqueValues(write, entry.id);
};

/** Applies an entry-level conversion to one entry (row-locked first, so it never races a content write). */
export const convertEntry = async (
  trx: Transaction<DB>,
  input: {
    entryId: string;
    modelId: string;
    change: SchemaChange;
    proposed: SchemaById;
    /** The activation's publication sequence number of a site (the entry's). */
    seqFor: (siteId: string) => SeqAllocator;
  },
): Promise<void> => {
  const { entryId, modelId, change, proposed } = input;
  const entry = await entriesRepository.lockById(entryId, trx);
  if (!entry || entry.deleted_at) {
    return;
  }
  const heads = await entryHeadsRepository.lockForEntry(entryId, trx);
  if (heads.length === 0) {
    return;
  }
  if (change.kind === 'field.localized' && change.to === false && change.fieldId) {
    await unifyField(trx, heads, change.fieldId, proposed.defaultLocale);
  } else if (change.kind === 'model.localized' && change.to === false) {
    await keepOneLocale(trx, input.seqFor(entry.site_id), entryId, heads, proposed.defaultLocale);
  } else if (change.kind === 'model.draftAndPublish' && change.to === false) {
    await publishAll(
      trx,
      input.seqFor(entry.site_id),
      proposed,
      { id: entryId, siteId: entry.site_id, modelId },
      heads,
    );
  }
};
