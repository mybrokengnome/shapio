import { sql, type Kysely } from 'kysely';

/**
 * App users (ADR 0005):
 * - `app_users.token_version`: carried in every access token and bumped on logout, block, password change,
 *   password reset and deletion, so the account's outstanding access tokens stop working on their next
 *   request instead of living out their TTL.
 * - `app_login_codes.code_challenge`: the PKCE-style S256 challenge the app sent when it started the OAuth
 *   sign-in; the one-time login code is only exchanged with the matching verifier. Codes live a minute, so
 *   any pending ones (issued without a challenge) are dropped rather than given a placeholder.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('app_users')
    .addColumn('token_version', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
  await sql`delete from app_login_codes`.execute(db);
  await db.schema
    .alterTable('app_login_codes')
    .addColumn('code_challenge', 'text', (col) => col.notNull())
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('app_login_codes').dropColumn('code_challenge').execute();
  await db.schema.alterTable('app_users').dropColumn('token_version').execute();
};
