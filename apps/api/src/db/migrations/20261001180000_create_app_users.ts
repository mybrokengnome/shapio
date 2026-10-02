import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

/**
 * App users (package I, ADR 0005): the end users of sites and apps built on Shapio, with their own roles
 * (`public` for anonymous callers, `authenticated` for every signed-in app user, plus custom roles), rotating
 * refresh tokens with reuse detection, OAuth identities, email confirmations, password resets and the
 * short-lived codes that hand an OAuth sign-in back to the app. Secrets are stored as SHA-256 hashes (tokens,
 * codes) or argon2id hashes (passwords), never in plain text.
 */

/**
 * Stable IDs of the built-in app roles. The evaluator refers to them directly (permissions/appRoles.ts holds
 * the same values); a migration never imports application code, so they are repeated here.
 */
const PUBLIC_ROLE_ID = '00000000-0000-4000-a000-000000000001';
const AUTHENTICATED_ROLE_ID = '00000000-0000-4000-a000-000000000002';

const withTimestamps = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

const uuidPrimaryKey = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`));

const createUsers = async (db: Kysely<unknown>) => {
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('app_users'))
      // Stored normalised (trimmed, lower case); uniqueness is also enforced case-insensitively below.
      .addColumn('email', 'text', (col) => col.notNull())
      .addColumn('name', 'text', (col) => col.notNull().defaultTo(''))
      // Null for accounts that only sign in with an OAuth provider.
      .addColumn('password_hash', 'text')
      .addColumn('confirmed_at', 'timestamptz')
      .addColumn('blocked_at', 'timestamptz')
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('password_changed_at', 'timestamptz')
      // Soft delete: personal data is scrubbed, the row stays for audit and content ownership history.
      .addColumn('deleted_at', 'timestamptz'),
  ).execute();
  await sql`create unique index app_users_email_uq on app_users (lower(email)) where deleted_at is null`.execute(
    db,
  );
  await sql`create index app_users_created_idx on app_users (created_at desc, id desc) where deleted_at is null`.execute(
    db,
  );
};

const createRoles = async (db: Kysely<unknown>) => {
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('app_roles'))
      .addColumn('key', 'text', (col) =>
        col
          .notNull()
          .unique()
          .check(sql`key ~ '^[a-z][a-z0-9-]{0,62}$'`),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
      // Built-in roles (public, authenticated) keep their key and name; their grants stay editable.
      .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
  ).execute();

  // Same grant shape as admin roles (permissions/policy.ts `Grant`), restricted to content actions.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('app_role_permissions'))
      .addColumn('role_id', 'uuid', (col) => col.notNull().references('app_roles.id').onDelete('cascade'))
      .addColumn('action', 'text', (col) =>
        col.notNull().check(sql`action in ('read', 'create', 'update', 'delete', 'publish')`),
      )
      .addColumn('model_id', 'text')
      .addColumn('condition', 'text', (col) => col.check(sql`condition in ('ownedByPrincipal')`))
      .addColumn('field_ids', sql`text[]`)
      .addUniqueConstraint('app_role_permissions_grant_uq', ['role_id', 'action', 'model_id'], (uc) =>
        uc.nullsNotDistinct(),
      ),
  ).execute();

  await db.schema
    .createTable('app_user_roles')
    .addColumn('app_user_id', 'uuid', (col) => col.notNull().references('app_users.id').onDelete('cascade'))
    // Restrict: a role still held by someone cannot be deleted (the service reports a conflict first).
    .addColumn('role_id', 'uuid', (col) => col.notNull().references('app_roles.id').onDelete('restrict'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('app_user_roles_pk', ['app_user_id', 'role_id'])
    .execute();
  await db.schema.createIndex('app_user_roles_role_idx').on('app_user_roles').column('role_id').execute();

  await sql`
    insert into app_roles (id, key, name, description, is_system) values
      (${PUBLIC_ROLE_ID}, 'public', 'Public',
        'Applies to every caller without a token. Grants nothing until you add permissions.', true),
      (${AUTHENTICATED_ROLE_ID}, 'authenticated', 'Authenticated',
        'Held by every signed-in app user, in addition to their custom roles. Grants nothing until you add permissions.', true)
  `.execute(db);
  // Neither built-in role grants anything by default (brief §8): an admin enables delivery deliberately.
};

const createCredentials = async (db: Kysely<unknown>) => {
  // One row per issued refresh token. A family is one sign-in; rotation adds a row to it and marks the
  // previous one used. Presenting a used token again revokes the whole family (reuse detection).
  await db.schema
    .createTable('app_refresh_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('app_user_id', 'uuid', (col) => col.notNull().references('app_users.id').onDelete('cascade'))
    .addColumn('family_id', 'uuid', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    // A rotated token may be presented once more within a short grace (a client retrying a lost response);
    // it gets the same replacement. Set when that one retry is spent.
    .addColumn('reuse_grace_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('revoked_reason', 'text')
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('app_refresh_tokens_family_idx')
    .on('app_refresh_tokens')
    .column('family_id')
    .execute();
  await db.schema
    .createIndex('app_refresh_tokens_user_idx')
    .on('app_refresh_tokens')
    .column('app_user_id')
    .where(sql.ref('revoked_at'), 'is', null)
    .execute();

  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('app_oauth_accounts'))
      .addColumn('app_user_id', 'uuid', (col) => col.notNull().references('app_users.id').onDelete('cascade'))
      .addColumn('provider', 'text', (col) => col.notNull().check(sql`provider in ('google', 'github')`))
      .addColumn('provider_user_id', 'text', (col) => col.notNull())
      // The address the provider reported at the last sign-in (verified or not), for support.
      .addColumn('email', 'text')
      .addUniqueConstraint('app_oauth_accounts_identity_uq', ['provider', 'provider_user_id']),
  ).execute();
  await db.schema
    .createIndex('app_oauth_accounts_user_idx')
    .on('app_oauth_accounts')
    .column('app_user_id')
    .execute();

  // Token hashes are written when the email job runs, so the plain token never sits in the jobs table.
  for (const table of ['email_confirmations', 'app_password_resets'] as const) {
    await withTimestamps(
      uuidPrimaryKey(db.schema.createTable(table))
        .addColumn('app_user_id', 'uuid', (col) =>
          col.notNull().references('app_users.id').onDelete('cascade'),
        )
        .addColumn('email', 'text', (col) => col.notNull())
        .addColumn('token_hash', 'text', (col) => col.unique())
        .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
        .addColumn('used_at', 'timestamptz'),
    ).execute();
    await db.schema.createIndex(`${table}_user_idx`).on(table).column('app_user_id').execute();
  }

  // One-time codes that hand an OAuth sign-in from the callback back to the app (exchanged for tokens).
  await db.schema
    .createTable('app_login_codes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('app_user_id', 'uuid', (col) => col.notNull().references('app_users.id').onDelete('cascade'))
    .addColumn('code_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await createUsers(db);
  await createRoles(db);
  await createCredentials(db);
  // Package E recorded owners without a foreign key; app_users is new, so any earlier value is an orphan.
  await sql`update entries set owner_app_user_id = null where owner_app_user_id is not null`.execute(db);
  await sql`
    alter table entries add constraint entries_owner_app_user_fk
      foreign key (owner_app_user_id) references app_users (id) on delete set null
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table entries drop constraint if exists entries_owner_app_user_fk`.execute(db);
  await db.schema.dropTable('app_login_codes').execute();
  await db.schema.dropTable('app_password_resets').execute();
  await db.schema.dropTable('email_confirmations').execute();
  await db.schema.dropTable('app_oauth_accounts').execute();
  await db.schema.dropTable('app_refresh_tokens').execute();
  await db.schema.dropTable('app_user_roles').execute();
  await db.schema.dropTable('app_role_permissions').execute();
  await db.schema.dropTable('app_roles').execute();
  await db.schema.dropTable('app_users').execute();
};
