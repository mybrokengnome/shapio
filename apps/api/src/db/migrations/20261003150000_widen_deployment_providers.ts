import { sql, type Kysely } from 'kysely';

/**
 * Deploy adapters (plan agentic-ecosystem §B2): deployment connections may use the Vercel and Netlify
 * providers. The check is re-added NOT VALID and then validated, so existing rows are checked without
 * blocking writes for the scan.
 */
const WIDENED = sql`provider in ('generic_webhook', 'cloudflare_pages', 'vercel', 'netlify', 'github')`;
const ORIGINAL = sql`provider in ('generic_webhook', 'cloudflare_pages', 'github')`;

const replaceCheck = async (db: Kysely<unknown>, check: typeof WIDENED) => {
  await sql`alter table deployment_connections drop constraint deployment_connections_provider_check`.execute(
    db,
  );
  await sql`alter table deployment_connections add constraint deployment_connections_provider_check
    check (${check}) not valid`.execute(db);
  await sql`alter table deployment_connections validate constraint deployment_connections_provider_check`.execute(
    db,
  );
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await replaceCheck(db, WIDENED);
};

/** Refuses while Vercel or Netlify connections exist: a down migration never deletes user data. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  const { rows } = await sql<{ count: string }>`
    select count(*)::text as count from deployment_connections where provider in ('vercel', 'netlify')
  `.execute(db);
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(
      `Cannot roll back: ${count} deployment connection(s) use Vercel or Netlify. Delete them in the admin (Publishing → Deployments) first, then run the rollback again.`,
    );
  }
  await replaceCheck(db, ORIGINAL);
};
