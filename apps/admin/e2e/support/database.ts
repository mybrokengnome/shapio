import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { SERVER_STATE } from './constants';

type ServerState = { database: string; maintenanceUrl: string };

/** Runs SQL against the e2e server's database (for fixtures the admin cannot create yet). */
const withServerDatabase = async <T>(run: (client: pg.Client) => Promise<T>): Promise<T> => {
  const state = JSON.parse(readFileSync(SERVER_STATE, 'utf8')) as ServerState;
  const url = new URL(state.maintenanceUrl);
  url.pathname = `/${state.database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

/**
 * Makes content reference a media asset, as package E's content saves do through
 * `services/mediaReferences.ts#addReferences`: a model, an entry, and its draft and published references.
 * The content admin (package F) does not exist yet, so the rows are written directly.
 */
export const seedMediaReference = (assetId: string) =>
  withServerDatabase(async (client) => {
    const modelId = randomUUID();
    await client.query(`insert into models (id, api_key, kind) values ($1, $2, 'collection')`, [
      modelId,
      `mediaE2e${Date.now()}`,
    ]);
    // The entry belongs to the primary site, where the admin's media library lives (sites plan §H).
    const entry = await client.query<{ id: string }>(
      `insert into entries (site_id, model_id)
       select id, $1 from sites where is_primary returning id`,
      [modelId],
    );
    const entryId = entry.rows[0]?.id;
    for (const state of ['draft', 'published']) {
      await client.query(
        `insert into media_references (asset_id, entry_id, model_id, field_id, locale, state)
         values ($1, $2, $3, 'f-hero', 'en', $4)`,
        [assetId, entryId, modelId, state],
      );
    }
    return { entryId, modelId };
  });
