import { sql, type Kysely } from 'kysely';

/**
 * SQLite twin of `../20261003170000_audit_events_seq.ts`. SQLite cannot add a column whose default calls a
 * function, so the table is rebuilt: the old one is renamed aside, the new one takes `seq` from the
 * `audit_events_seq` row in `sequences` (like `entry_heads.change_seq`), and the rows are copied in
 * `(occurred_at, id)` order so existing events are numbered oldest first. Nothing references `audit_events`.
 */
const COLUMNS = [
  'id',
  'occurred_at',
  'actor_type',
  'actor_id',
  'action',
  'target_type',
  'target_id',
  'outcome',
  'request_id',
  'ip',
  'metadata',
  'site_id',
] as const;

const INDEXES = [
  `create index "audit_events_actor_idx" on "audit_events" (actor_type, actor_id, occurred_at DESC)`,
  `create index "audit_events_occurred_at_idx" on "audit_events" (occurred_at DESC)`,
  `create index "audit_events_target_idx" on "audit_events" (target_type, target_id, occurred_at DESC)`,
];

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`insert into "sequences" (name, value) values ('audit_events_seq', 0)`.execute(db);
  await sql`alter table "audit_events" rename to "audit_events_before_seq"`.execute(db);
  await sql`create table "audit_events" (
    "id" text_uuid not null default (gen_random_uuid()),
    "occurred_at" text_timestamptz not null default (shapio_now()),
    "actor_type" text not null,
    "actor_id" text,
    "action" text not null,
    "target_type" text,
    "target_id" text,
    "outcome" text not null,
    "request_id" text,
    "ip" text,
    "metadata" text_jsonb not null default ('{}'),
    "site_id" text_uuid,
    "seq" bigint not null default (shapio_nextval('audit_events_seq')),
    constraint "audit_events_actor_type_check" CHECK ((actor_type IN ('admin', 'app_user', 'token', 'anonymous', 'system'))),
    constraint "audit_events_outcome_check" CHECK ((outcome IN ('success', 'failure'))),
    constraint "audit_events_site_fk" foreign key (site_id) references sites (id) on delete set null,
    constraint "audit_events_pkey" primary key (id)
  )`.execute(db);
  const columns = sql.join(COLUMNS.map((column) => sql.ref(column)));
  // Each copied row takes its `seq` from the column default, in the SELECT's order.
  await sql`insert into "audit_events" (${columns})
    select ${columns} from "audit_events_before_seq" order by occurred_at, id`.execute(db);
  await sql`drop table "audit_events_before_seq"`.execute(db);
  for (const statement of INDEXES) {
    await sql.raw(statement).execute(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "audit_events" drop column "seq"`.execute(db);
  await sql`delete from "sequences" where name = 'audit_events_seq'`.execute(db);
};
