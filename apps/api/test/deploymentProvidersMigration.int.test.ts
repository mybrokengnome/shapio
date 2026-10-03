import { sql, type Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../src/db/migrations/20261003150000_widen_deployment_providers.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** Vercel and Netlify connections (plan agentic-ecosystem §B2); rolling back never deletes them. */
describe('migration: widen deployment providers', () => {
  const database = useTestDatabase();

  it('accepts Vercel and Netlify, and down refuses while such connections exist', async () => {
    // Migrations run on an untyped Kysely (they predate the generated types they create).
    const db = database.current.db as unknown as Kysely<unknown>;
    const insert = (provider: string) =>
      sql`insert into deployment_connections (site_id, name, provider, secrets_encrypted)
        values ((select id from sites order by created_at limit 1), ${provider}, ${provider}, 'sealed')`.execute(
        db,
      );
    try {
      await insert('vercel');
      await insert('netlify');
      await expect(down(db)).rejects.toThrow(
        /Cannot roll back: 2 deployment connection\(s\) use Vercel or Netlify/,
      );

      await sql`delete from deployment_connections where provider in ('vercel', 'netlify')`.execute(db);
      await down(db);
      await expect(insert('vercel')).rejects.toThrow(/deployment_connections_provider_check/);
      await insert('cloudflare_pages');

      await up(db);
      await insert('netlify');
    } finally {
      await sql`delete from deployment_connections`.execute(db);
    }
  });
});
