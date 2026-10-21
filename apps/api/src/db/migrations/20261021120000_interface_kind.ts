import { sql, type Kysely } from 'kysely';

/**
 * Interfaces (plan interfaces, ADR 0013): a definition of kind `interface` lives in `models` like a model or
 * a component, and a change set may hold a draft of one. Both `kind` check constraints gain the value. MySQL
 * has its own twin; SQLite rebuilds the two tables (`./sqlite/20261021120000_interface_kind.ts`). `down`
 * refuses while an interface exists: its rows would break the narrower check.
 */
export const TABLES = ['models', 'schema_drafts'] as const;

export const KINDS_BEFORE = ['collection', 'singleton', 'component'] as const;
export const KINDS_AFTER = [...KINDS_BEFORE, 'interface'] as const;

/** Throws when a table still holds an interface row (the `down` of every dialect). */
export const assertNoInterfaces = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    const { rows } = await sql<{
      count: string | number;
    }>`select count(*) as count from ${sql.table(table)} where kind = 'interface'`.execute(db);
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        `Cannot roll back interfaces while ${table} holds an interface. Delete the interfaces (and change-set drafts of them) first.`,
      );
    }
  }
};

const swap = async (db: Kysely<unknown>, kinds: readonly string[]): Promise<void> => {
  const allowed = sql.join(kinds.map((kind) => sql.lit(kind)));
  for (const table of TABLES) {
    const constraint = `${table}_kind_check`;
    await sql`alter table ${sql.table(table)} drop constraint ${sql.id(constraint)}`.execute(db);
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(constraint)} check (kind in (${allowed}))`.execute(
      db,
    );
  }
};

export const up = (db: Kysely<unknown>): Promise<void> => swap(db, KINDS_AFTER);

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await assertNoInterfaces(db);
  await swap(db, KINDS_BEFORE);
};
