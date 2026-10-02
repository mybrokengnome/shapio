import { resolve } from 'node:path';
import { defineConfig } from 'kysely-ctl';
import { loadConfig, loadEnvFileIfPresent } from './src/config/index.js';
import { createDb } from './src/db/index.js';
import { staticMigrationProvider } from './src/db/migrations/index.js';

// Development tooling only (pnpm db:*). The server and `shapio migrate` use src/db/migrator.ts directly.
loadEnvFileIfPresent(resolve(import.meta.dirname, '../../.env'));
const config = loadConfig();

export default defineConfig({
  kysely: createDb({
    connectionString: config.database.url,
    poolMax: 2,
    applicationName: 'shapio-kysely-ctl',
  }),
  migrations: {
    // Same static list the server uses; kysely-ctl's default Migrator rejects out-of-order migrations.
    provider: staticMigrationProvider,
  },
});
