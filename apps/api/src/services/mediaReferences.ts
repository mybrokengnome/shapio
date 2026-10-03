import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import * as mediaReferencesRepository from '../repositories/mediaReferences.js';
import type { ReferenceScope } from '../repositories/mediaReferences.js';

/**
 * Media references for package E. Content saves call these inside the transaction that moves an entry
 * head, so "used in" and delete protection always match the committed heads. References are per entry
 * head: (entry, locale, state ∈ draft|published), one row per (asset, field).
 */

export type MediaReference = {
  assetId: string;
  entryId: string;
  modelId: string;
  /** Stable field ID (the top-level field, also for media inside components or rich text). */
  fieldId: string;
  locale: string;
  state: 'draft' | 'published';
};

/** Adds references; existing ones are left as they are. */
export const addReferences = (trx: Transaction<DB>, references: readonly MediaReference[]) =>
  mediaReferencesRepository.insertMany(
    references.map((reference) => ({
      asset_id: reference.assetId,
      entry_id: reference.entryId,
      model_id: reference.modelId,
      field_id: reference.fieldId,
      locale: reference.locale,
      state: reference.state,
    })),
    trx,
  );

/** Removes an entry's references: all of them, or one locale and/or state. Returns how many went. */
export const removeReferences = (trx: Transaction<DB>, scope: ReferenceScope) =>
  mediaReferencesRepository.deleteForEntry(scope, trx);

/**
 * Sets the references of one entry head to exactly `references` (the media found in its new data).
 * The usual call from a head-moving write.
 */
export const replaceHeadReferences = async (
  trx: Transaction<DB>,
  head: { entryId: string; locale: string; state: 'draft' | 'published' },
  references: readonly Omit<MediaReference, 'entryId' | 'locale' | 'state'>[],
) => {
  await removeReferences(trx, head);
  await addReferences(
    trx,
    references.map((reference) => ({ ...reference, ...head })),
  );
};

export { listUsagesOnSite } from './mediaAssets.js';
