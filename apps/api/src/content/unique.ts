import { createHash } from 'node:crypto';
import { UNIQUE_CAPABLE_DATA_TYPES, type FieldDefinition, type ModelDefinition } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { ContentData } from '../db/contentData.js';
import type { DB } from '../db/types.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import type { UniqueKey } from '../repositories/uniqueValues.js';
import { isLocalizedField, SHARED_LOCALE } from './model.js';
import { contentInvalid } from './validator/issues.js';

/**
 * The unique-value registry (ADR 0001): `(field, locale, state, value hash) → entry`, written in the
 * transaction that moves the heads. A pre-save SELECT could not stop two concurrent writers; the registry's
 * primary key does. Uniqueness holds among drafts and among published heads separately; shared fields
 * register under locale `*` because every locale holds the same value.
 */

/** Per-type normalization: values that mean the same must hash the same. */
export const normalizeUniqueValue = (field: FieldDefinition, raw: unknown): string | undefined => {
  // Unique-capable types are stored as JSON strings or numbers (validated before they get here).
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return undefined;
  }
  const value = String(raw);
  if (value === '') {
    return undefined;
  }
  switch (field.type) {
    case 'email':
      return value.trim().toLowerCase();
    case 'string':
    case 'url':
    case 'slug':
    case 'uid':
      return value.trim();
    case 'number':
    case 'integer':
      return String(Number(value));
    case 'biginteger':
      return BigInt(value).toString();
    case 'decimal': {
      const [whole = '0', fraction = ''] = value.split('.');
      const trimmed = fraction.replace(/0+$/, '');
      const normalizedWhole = whole.replace(/^(-?)0+(?=\d)/, '$1');
      const text = trimmed ? `${normalizedWhole}.${trimmed}` : normalizedWhole;
      return text === '-0' ? '0' : text;
    }
    default:
      return value;
  }
};

export const hashUniqueValue = (normalized: string) => createHash('sha256').update(normalized).digest('hex');

/** Top-level fields the registry tracks for a model. */
export const uniqueFields = (model: ModelDefinition): FieldDefinition[] =>
  model.fields.filter(
    (field) => field.unique && !field.deprecated && UNIQUE_CAPABLE_DATA_TYPES.has(field.type),
  );

export type HeadValues = { locale: string; state: string; data: Readonly<ContentData> };

/** The registry keys the given heads of one entry hold, for the given fields. */
export const uniqueKeysOf = (
  model: ModelDefinition,
  fields: readonly FieldDefinition[],
  heads: readonly HeadValues[],
): Map<string, UniqueKey & { field: FieldDefinition }> => {
  const keys = new Map<string, UniqueKey & { field: FieldDefinition }>();
  for (const head of heads) {
    for (const field of fields) {
      const normalized = normalizeUniqueValue(field, head.data[field.id]);
      if (normalized === undefined) {
        continue;
      }
      const key = {
        field,
        fieldId: field.id,
        locale: isLocalizedField(model, field) ? head.locale : SHARED_LOCALE,
        state: head.state,
        valueHash: hashUniqueValue(normalized),
      };
      keys.set(`${key.fieldId}|${key.locale}|${key.state}|${key.valueHash}`, key);
    }
  }
  return keys;
};

const keyString = (key: { field_id: string; locale: string; state: string; value_hash: string }) =>
  `${key.field_id}|${key.locale}|${key.state}|${key.value_hash}`;

/**
 * Makes an entry's registry rows match its current heads for the given fields: releases values it no longer
 * holds, claims new ones, and fails with a 422 `NOT_UNIQUE` issue when another entry holds a value.
 */
export const syncUniqueValues = async (
  trx: Transaction<DB>,
  input: {
    entryId: string;
    model: ModelDefinition;
    fields: readonly FieldDefinition[];
    heads: readonly HeadValues[];
  },
): Promise<void> => {
  const { entryId, model, fields, heads } = input;
  if (fields.length === 0) {
    return;
  }
  const desired = uniqueKeysOf(model, fields, heads);
  const existing = await uniqueValuesRepository.listForEntry(
    entryId,
    fields.map((field) => field.id),
    trx,
  );
  for (const row of existing) {
    if (!desired.has(keyString(row))) {
      await uniqueValuesRepository.removeKey(
        entryId,
        {
          fieldId: row.field_id,
          locale: row.locale,
          state: row.state,
          valueHash: row.value_hash,
        },
        trx,
      );
    }
  }
  const held = new Set(existing.map(keyString));
  const conflicts = new Set<FieldDefinition>();
  // Claim in a stable order so concurrent writers wait on keys in the same sequence (no deadlock).
  for (const [id, key] of [...desired].sort(([a], [b]) => a.localeCompare(b))) {
    if (held.has(id)) {
      continue;
    }
    const owner = await uniqueValuesRepository.claim({ ...key, entryId, modelId: model.id }, trx);
    if (owner !== entryId) {
      conflicts.add(key.field);
    }
  }
  if (conflicts.size > 0) {
    throw contentInvalid(
      [...conflicts].map((field) => ({
        path: `/${field.apiKey}`,
        code: 'NOT_UNIQUE' as const,
        message: 'is already used by another entry',
      })),
    );
  }
};

/**
 * The unique values that publishing these drafts would claim among published heads but another entry's
 * published version already holds (read-only: no claims, no locks). Uniqueness is per locale for localized
 * fields, so the same slug in en and fr is fine.
 */
export const findPublishedUniqueConflicts = async (
  executor: Kysely<DB> | Transaction<DB>,
  input: { entryId: string; model: ModelDefinition; drafts: readonly Omit<HeadValues, 'state'>[] },
): Promise<{ locale: string; fieldId: string }[]> => {
  const fields = uniqueFields(input.model);
  if (fields.length === 0) {
    return [];
  }
  const perDraft = input.drafts.map((draft) => ({
    locale: draft.locale,
    keys: [...uniqueKeysOf(input.model, fields, [{ ...draft, state: 'published' }]).values()],
  }));
  const owners = await uniqueValuesRepository.findOtherOwners(
    input.entryId,
    perDraft.flatMap((draft) => draft.keys),
    executor,
  );
  const taken = new Set(owners.map((row) => keyString(row)));
  return perDraft.flatMap(({ locale, keys }) =>
    keys
      .filter((key) =>
        taken.has(
          keyString({
            field_id: key.fieldId,
            locale: key.locale,
            state: key.state,
            value_hash: key.valueHash,
          }),
        ),
      )
      .map((key) => ({ locale, fieldId: key.fieldId })),
  );
};
