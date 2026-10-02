import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

/**
 * Admin identity (package B, ADR 0005): admin users, roles and their permission grants, server-side
 * sessions, invitations, password resets, first-run setup tokens and API tokens. Every secret is stored
 * as a SHA-256 hash (tokens) or an argon2id hash (passwords), never in plain text.
 */

const withTimestamps = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

const uuidPrimaryKey = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`));

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('admin_users'))
      // Stored normalised (trimmed, lower case); the service normalises before every lookup.
      .addColumn('email', 'text', (col) => col.notNull().unique())
      .addColumn('name', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('password_hash', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) =>
        col
          .notNull()
          .defaultTo('active')
          .check(sql`status in ('active', 'disabled')`),
      )
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('password_changed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`)),
  ).execute();

  // `kind`: admin roles are held by admin users and admin-scope tokens; delivery roles only by delivery tokens.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('admin_roles'))
      .addColumn('key', 'text', (col) =>
        col
          .notNull()
          .unique()
          .check(sql`key ~ '^[a-z][a-z0-9-]{0,62}$'`),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('kind', 'text', (col) =>
        col
          .notNull()
          .defaultTo('admin')
          .check(sql`kind in ('admin', 'delivery')`),
      )
      .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
  ).execute();

  // One grant per (role, action, model). `model_id` null = every model (and is required for global
  // actions). `field_ids` null = every field the principal kind may see; otherwise only these stable IDs.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('admin_role_permissions'))
      .addColumn('role_id', 'uuid', (col) => col.notNull().references('admin_roles.id').onDelete('cascade'))
      .addColumn('action', 'text', (col) => col.notNull())
      .addColumn('model_id', 'text')
      .addColumn('condition', 'text', (col) => col.check(sql`condition in ('ownedByPrincipal')`))
      .addColumn('field_ids', sql`text[]`)
      .addUniqueConstraint('admin_role_permissions_grant_uq', ['role_id', 'action', 'model_id'], (uc) =>
        uc.nullsNotDistinct(),
      ),
  ).execute();

  await withTimestamps(
    db.schema
      .createTable('admin_user_roles')
      .addColumn('admin_user_id', 'uuid', (col) =>
        col.notNull().references('admin_users.id').onDelete('cascade'),
      )
      // Restrict: a role still held by someone cannot be deleted (the service reports a conflict first).
      .addColumn('role_id', 'uuid', (col) => col.notNull().references('admin_roles.id').onDelete('restrict'))
      .addPrimaryKeyConstraint('admin_user_roles_pk', ['admin_user_id', 'role_id']),
  ).execute();
  await db.schema.createIndex('admin_user_roles_role_idx').on('admin_user_roles').column('role_id').execute();

  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('admin_sessions'))
      .addColumn('admin_user_id', 'uuid', (col) =>
        col.notNull().references('admin_users.id').onDelete('cascade'),
      )
      .addColumn('token_hash', 'text', (col) => col.notNull().unique())
      // Server-side CSRF secret bound to this session (@fastify/csrf-protection session mode).
      .addColumn('csrf_secret', 'text', (col) => col.notNull())
      .addColumn('ip', 'text')
      .addColumn('user_agent', 'text')
      .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
      .addColumn('revoked_at', 'timestamptz')
      // Set when the user's privileges change; the next request gets a fresh session ID.
      .addColumn('rotation_required', 'boolean', (col) => col.notNull().defaultTo(false)),
  ).execute();
  await db.schema
    .createIndex('admin_sessions_user_idx')
    .on('admin_sessions')
    .column('admin_user_id')
    .where(sql.ref('revoked_at'), 'is', null)
    .execute();

  // The token hash is written when the email job runs, so the plain token never sits in the jobs table.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('admin_invitations'))
      .addColumn('email', 'text', (col) => col.notNull())
      .addColumn('role_ids', sql`uuid[]`, (col) => col.notNull().defaultTo(sql`'{}'::uuid[]`))
      .addColumn('token_hash', 'text', (col) => col.unique())
      .addColumn('invited_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
      .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
      .addColumn('accepted_at', 'timestamptz')
      .addColumn('revoked_at', 'timestamptz'),
  ).execute();
  await db.schema
    .createIndex('admin_invitations_pending_email_idx')
    .on('admin_invitations')
    .column('email')
    .where(sql<boolean>`accepted_at is null and revoked_at is null`)
    .execute();

  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('password_resets'))
      .addColumn('admin_user_id', 'uuid', (col) =>
        col.notNull().references('admin_users.id').onDelete('cascade'),
      )
      .addColumn('token_hash', 'text', (col) => col.unique())
      .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
      .addColumn('used_at', 'timestamptz'),
  ).execute();
  await db.schema
    .createIndex('password_resets_user_idx')
    .on('password_resets')
    .column('admin_user_id')
    .execute();

  // A new token is issued (and the previous one superseded) on every boot while no admin exists.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('setup_tokens'))
      .addColumn('token_hash', 'text', (col) => col.notNull().unique())
      .addColumn('used_at', 'timestamptz')
      .addColumn('superseded_at', 'timestamptz'),
  ).execute();

  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('api_tokens'))
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('token_hash', 'text', (col) => col.notNull().unique())
      // First characters of the token, shown in lists so people can tell tokens apart.
      .addColumn('token_prefix', 'text', (col) => col.notNull())
      .addColumn('role_id', 'uuid', (col) => col.notNull().references('admin_roles.id').onDelete('restrict'))
      .addColumn('created_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
      .addColumn('expires_at', 'timestamptz')
      .addColumn('last_used_at', 'timestamptz')
      .addColumn('revoked_at', 'timestamptz'),
  ).execute();
  await db.schema.createIndex('api_tokens_role_idx').on('api_tokens').column('role_id').execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('api_tokens').execute();
  await db.schema.dropTable('setup_tokens').execute();
  await db.schema.dropTable('password_resets').execute();
  await db.schema.dropTable('admin_invitations').execute();
  await db.schema.dropTable('admin_sessions').execute();
  await db.schema.dropTable('admin_user_roles').execute();
  await db.schema.dropTable('admin_role_permissions').execute();
  await db.schema.dropTable('admin_roles').execute();
  await db.schema.dropTable('admin_users').execute();
};
