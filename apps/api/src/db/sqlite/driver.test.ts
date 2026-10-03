import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely, type Transaction } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setCurrentDialect } from '../dialect.js';
import { subscribeNotifications } from '../notifyHub.js';
import { isForeignKeyViolation, isUniqueViolation } from '../sql/errors.js';
import { asJson, asTimestamp } from '../sql/typed.js';
import { notificationKeyOf } from './driver.js';
import { createSqliteDb, sqliteDriverOf } from './index.js';

type Row = Record<string, unknown>;
type TestDb = Kysely<Record<string, Row>>;

const directory = mkdtempSync(join(tmpdir(), 'shapio-sqlite-driver-'));
const path = join(directory, 'test.db');
let db: TestDb;

const until = (predicate: () => boolean) =>
  new Promise<void>((resolve) => {
    const check = () => (predicate() ? resolve() : setImmediate(check));
    check();
  });

beforeAll(async () => {
  setCurrentDialect('sqlite', { force: true });
  db = createSqliteDb<Record<string, Row>>({ location: { kind: 'file', path }, readers: 2, strict: true });
  await sql`create table sequences (name text primary key, value integer not null)`.execute(db);
  await sql`insert into sequences values ('s', 0)`.execute(db);
  await sql`create table parents (id text_uuid primary key)`.execute(db);
  await sql`create table things (
    id integer primary key,
    at text_timestamptz not null default (shapio_now()),
    day text_date,
    flag integer_boolean not null default 0,
    data text_jsonb,
    tags text_array,
    big bigint,
    n integer,
    name text,
    parent_id text_uuid references parents (id)
  )`.execute(db);
  await sql`create unique index things_name_uq on things (name)`.execute(db);
  await sql`create unique index things_folded_uq on things (lower(data ->> 'k'))`.execute(db);
});

afterAll(async () => {
  await db.destroy();
  rmSync(directory, { recursive: true, force: true });
  setCurrentDialect('postgres', { force: true });
});

describe('SQLite value codec', () => {
  it('round-trips PostgreSQL-shaped values', async () => {
    const at = new Date('2026-10-03T12:34:56.789Z');
    await db
      .insertInto('things')
      .values({
        at,
        day: '2026-10-03',
        flag: true,
        data: { a: [1, 'x'] },
        tags: ['a', 'b'],
        big: '9007199254740993',
        n: 7,
        name: 'one',
      })
      .execute();
    const row = await db.selectFrom('things').selectAll().where('name', '=', 'one').executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      at,
      day: '2026-10-03',
      flag: true,
      data: { a: [1, 'x'] },
      tags: ['a', 'b'],
      big: '9007199254740993',
      n: 7,
    });
    const stored = await sql<{
      at: string;
    }>`select 'stored ' || at as at from things where name = 'one'`.execute(db);
    expect(stored.rows[0]?.at).toBe('stored 2026-10-03T12:34:56.789Z');
  });

  it('decodes through subqueries and RETURNING by the origin column', async () => {
    const inserted = await db
      .insertInto('things')
      .values({ name: 'two' })
      .returning(['at', 'flag'])
      .executeTakeFirstOrThrow();
    expect(inserted.at).toBeInstanceOf(Date);
    expect(inserted.flag).toBe(false);
    const nested = await db
      .selectFrom((qb) => qb.selectFrom('things').select(['at', 'flag']).as('t'))
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(nested.at).toBeInstanceOf(Date);
  });

  it('refuses values it cannot store instead of writing NULL', async () => {
    await expect(sql`select ${undefined as never} as x`.execute(db)).rejects.toThrow(/Cannot bind undefined/);
    await expect(sql`select ${new Map() as never} as x`.execute(db)).rejects.toThrow(/Cannot bind Map/);
  });

  it('decodes marked computed columns and fails on unmarked timestamps and JSON in strict mode', async () => {
    const marked = await db
      .selectFrom('things')
      .select((eb) => [asTimestamp(eb.fn.max('at')).as('latest'), asJson(sql`json_array(1, 2)`).as('list')])
      .executeTakeFirstOrThrow();
    expect(marked.latest).toBeInstanceOf(Date);
    expect(marked.list).toEqual([1, 2]);
    await expect(
      db
        .selectFrom('things')
        .select((eb) => eb.fn.max('at').as('latest'))
        .execute(),
    ).rejects.toThrow(/asTimestamp/);
    await expect(
      db
        .selectFrom('things')
        .select(sql`json_array(1)`.as('list'))
        .execute(),
    ).rejects.toThrow(/asJson/);
  });
});

describe('SQLite plugin', () => {
  it('orders NULLs as PostgreSQL does and drops row locks', async () => {
    await db.insertInto('things').values({ name: null, n: 1 }).execute();
    const ascending = await db
      .selectFrom('things')
      .select('name')
      .orderBy('name')
      .forUpdate()
      .skipLocked()
      .execute();
    expect(ascending.at(-1)?.name).toBeNull();
    const descending = await db.selectFrom('things').select('name').orderBy('name', 'desc').execute();
    expect(descending[0]?.name).toBeNull();
  });
});

describe('SQLite errors', () => {
  it('names unique indexes and attributes foreign keys to the written table', async () => {
    const duplicate = await db
      .insertInto('things')
      .values({ name: 'one' })
      .execute()
      .catch((error: unknown) => error);
    expect(isUniqueViolation(duplicate, 'things_name_uq')).toBe(true);
    const folded = await db
      .insertInto('things')
      .values([{ name: 'k1', data: { k: 'É' } }])
      .execute()
      .then(() =>
        db
          .insertInto('things')
          .values({ name: 'k2', data: { k: 'é' } })
          .execute(),
      )
      .catch((error: unknown) => error);
    expect(isUniqueViolation(folded, 'things_folded_uq')).toBe(true);
    const orphan = await db
      .insertInto('things')
      .values({ name: 'orphan', parent_id: '00000000-0000-4000-8000-000000000001' })
      .execute()
      .catch((error: unknown) => error);
    expect(isForeignKeyViolation(orphan)).toBe(true);
    expect(isForeignKeyViolation(orphan, 'change_set_items_entry_site_fk')).toBe(false);
  });
});

describe('SQLite transactions', () => {
  it('keeps now() constant within a transaction and rolls sequences back', async () => {
    const times = await db.transaction().execute(async (trx) => {
      const first = await sql<{ t: string }>`select 'at ' || shapio_now() as t`.execute(trx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await sql<{ t: string }>`select 'at ' || shapio_now() as t`.execute(trx);
      return [first.rows[0]?.t, second.rows[0]?.t];
    });
    expect(times[0]).toBe(times[1]);
    await db
      .transaction()
      .execute(async (trx) => {
        await sql`select shapio_nextval('s')`.execute(trx);
        throw new Error('roll back');
      })
      .catch(() => undefined);
    const next = await sql<{ v: string }>`select shapio_nextval('s') as v`.execute(db);
    expect(Number(next.rows[0]?.v)).toBe(1);
  });

  it('reads committed data outside a write transaction and a snapshot inside a read-only one', async () => {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('things').values({ name: 'pending' }).execute();
      const outside = await db.selectFrom('things').select('name').where('name', '=', 'pending').execute();
      expect(outside).toEqual([]);
    });
    const snapshot = db
      .transaction()
      .setAccessMode('read only')
      .execute(async (trx) => {
        const before = await trx.selectFrom('things').select('name').execute();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const after = await trx.selectFrom('things').select('name').execute();
        return [before.length, after.length];
      });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.insertInto('things').values({ name: 'later' }).execute();
    const [before, after] = await snapshot;
    expect(after).toBe(before);
  });

  it('fails a write that would wait for its own enclosing transaction', async () => {
    const attempt = db.transaction().execute(async (trx) => {
      await trx.insertInto('things').values({ name: 'inner' }).execute();
      await db.insertInto('things').values({ name: 'outer' }).execute();
    });
    await expect(attempt).rejects.toThrow(/would wait for that transaction forever/);
    const nested = db.transaction().execute(async () => {
      await db.transaction().execute(async (inner) => {
        await inner.insertInto('things').values({ name: 'nested' }).execute();
      });
    });
    await expect(nested).rejects.toThrow(/would wait/);
  });

  it('delivers notifications on commit only', async () => {
    const received: string[] = [];
    const unsubscribe = subscribeNotifications(
      notificationKeyOf({ kind: 'file', path }),
      (_channel, payload) => received.push(payload ?? ''),
    );
    await db
      .transaction()
      .execute(async (trx) => {
        await sql`select shapio_notify('c', 'rolled back')`.execute(trx);
        throw new Error('roll back');
      })
      .catch(() => undefined);
    await db.transaction().execute(async (trx) => {
      await sql`select shapio_notify('c', 'committed')`.execute(trx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(received).toEqual([]);
    });
    await until(() => received.length > 0);
    expect(received).toEqual(['committed']);
    unsubscribe();
  });
});

describe('SQLite in memory', () => {
  it('runs reads, writes and read-only transactions on its one connection', async () => {
    const memory = createSqliteDb<Record<string, Row>>({ location: { kind: 'memory' }, readers: 2 });
    try {
      await sql`create table notes (body text)`.execute(memory);
      await memory.transaction().execute(async (trx) => {
        await trx.insertInto('notes').values({ body: 'one' }).execute();
      });
      const read = await memory
        .transaction()
        .setAccessMode('read only')
        .execute((trx) => trx.selectFrom('notes').select('body').execute());
      expect(read).toEqual([{ body: 'one' }]);
    } finally {
      await memory.destroy();
    }
  });
});

describe('SQLite planner statistics', () => {
  const statsPath = join(directory, 'stats.db');
  const statsOf = (handle: TestDb) =>
    sql<{ tbl: string }>`select tbl from sqlite_stat1 where tbl = 'stats_rows'`.execute(handle);

  it('analyzes unanalyzed tables when the writer opens and on request between writes', async () => {
    const first = createSqliteDb<Record<string, Row>>({
      location: { kind: 'file', path: statsPath },
      readers: 1,
    });
    await sql`create table stats_rows (id integer primary key, k text not null)`.execute(first);
    await sql`create index stats_rows_k_idx on stats_rows (k)`.execute(first);
    await sql`insert into stats_rows (k) select 'k' || value from json_each(${JSON.stringify(
      Array.from({ length: 200 }, (_, i) => i),
    )})`.execute(first);
    await expect(sql`select * from sqlite_stat1`.execute(first)).rejects.toThrow();
    await sqliteDriverOf(first)!.optimizeStatistics('full');
    expect((await statsOf(first)).rows).toEqual([{ tbl: 'stats_rows' }]);
    await first.destroy();

    rmSync(statsPath);
    const second = createSqliteDb<Record<string, Row>>({
      location: { kind: 'file', path: statsPath },
      readers: 1,
    });
    await sql`create table stats_rows (id integer primary key, k text not null)`.execute(second);
    await sql`create index stats_rows_k_idx on stats_rows (k)`.execute(second);
    await sql`insert into stats_rows (k) values ('a'), ('b')`.execute(second);
    await second.destroy();
    const reopened = createSqliteDb<Record<string, Row>>({
      location: { kind: 'file', path: statsPath },
      readers: 1,
    });
    // Opening the writer (any statement) runs PRAGMA optimize=0x10002.
    await sql`select 1`.execute(reopened);
    expect((await statsOf(reopened)).rows).toEqual([{ tbl: 'stats_rows' }]);
    await reopened.destroy();
  });

  it('reopens readers when the statistics change, so their plans use them', async () => {
    const planPath = join(directory, 'plan.db');
    const handle = createSqliteDb<Record<string, Row>>({
      location: { kind: 'file', path: planPath },
      readers: 1,
    });
    await sql`create table plan_rows (id integer primary key, a integer, b integer)`.execute(handle);
    await sql`create index plan_rows_a on plan_rows (a)`.execute(handle);
    await sql`create index plan_rows_b on plan_rows (b)`.execute(handle);
    // An empty sqlite_stat1, as after migrating empty tables: filling it later changes no schema.
    await sqliteDriverOf(handle)!.optimizeStatistics('full');
    await sql`insert into plan_rows (a, b) select value % 2, value from json_each(${JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => i),
    )})`.execute(handle);
    const plan = async (executor: TestDb | Transaction<Record<string, Row>>) =>
      (
        await sql<{
          detail: string;
        }>`explain query plan select id from plan_rows where a = 1 and b > 1990`.execute(executor)
      ).rows.map((row) => row.detail);
    const inReadTransaction = () =>
      handle
        .transaction()
        .setAccessMode('read only')
        .execute((trx) => plan(trx));
    // Without statistics the equality wins.
    expect(await plan(handle)).toEqual(['SEARCH plan_rows USING INDEX plan_rows_a (a=?)']);
    expect(await inReadTransaction()).toEqual(['SEARCH plan_rows USING INDEX plan_rows_a (a=?)']);

    await sqliteDriverOf(handle)!.optimizeStatistics('full');
    // With them, `a` is known to match half the rows: autocommit and transaction readers both see that.
    expect(await plan(handle)).toEqual(['SEARCH plan_rows USING INDEX plan_rows_b (b>?)']);
    expect(await inReadTransaction()).toEqual(['SEARCH plan_rows USING INDEX plan_rows_b (b>?)']);
    await handle.destroy();
  });
});
