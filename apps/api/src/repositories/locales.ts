import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

const COLUMNS = ['code', 'label', 'is_default', 'fallbacks', 'created_at', 'updated_at'] as const;

export const list = (executor: Executor = db) =>
  executor.selectFrom('locales').select(COLUMNS).orderBy('is_default', 'desc').orderBy('code').execute();

export type LocaleRow = Awaited<ReturnType<typeof list>>[number];

export const findByCode = (code: string, executor: Executor = db) =>
  executor.selectFrom('locales').select(COLUMNS).where('code', '=', code).executeTakeFirst();

export const insert = (locale: { code: string; label: string; fallbacks: string[] }, trx: Executor = db) =>
  trx
    .insertInto('locales')
    .values({ code: locale.code, label: locale.label, fallbacks: locale.fallbacks, is_default: false })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();

export const update = (
  code: string,
  changes: { label: string; fallbacks: string[]; now: Date },
  trx: Executor = db,
) =>
  trx
    .updateTable('locales')
    .set({ label: changes.label, fallbacks: changes.fallbacks, updated_at: changes.now })
    .where('code', '=', code)
    .returning(COLUMNS)
    .executeTakeFirst();

/** Makes `code` the only default locale. Clears the old default first (single-default unique index). */
export const setDefault = async (code: string, now: Date, trx: Executor = db) => {
  await trx
    .updateTable('locales')
    .set({ is_default: false, updated_at: now })
    .where('is_default', '=', true)
    .execute();
  await trx
    .updateTable('locales')
    .set({ is_default: true, updated_at: now })
    .where('code', '=', code)
    .execute();
};

export const remove = (code: string, trx: Executor = db) =>
  trx.deleteFrom('locales').where('code', '=', code).executeTakeFirst();

/** Removes `code` from every other locale's fallback chain. */
export const removeFromFallbacks = async (code: string, now: Date, trx: Executor = db) => {
  const rows = await trx.selectFrom('locales').select(['code', 'fallbacks']).execute();
  for (const row of rows.filter((candidate) => candidate.fallbacks.includes(code))) {
    await trx
      .updateTable('locales')
      .set({ fallbacks: row.fallbacks.filter((entry) => entry !== code), updated_at: now })
      .where('code', '=', row.code)
      .execute();
  }
};
