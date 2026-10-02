// A second API instance for schema coordination tests. Same app as `shapio start`, minus migrations and
// the worker, with the schema LISTEN client switchable via SCHEMA_LISTEN=false so tests can prove the
// durable version check alone keeps the instance correct.
import { pino } from 'pino';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createDb } from '../../src/db/index.js';
import { runMain } from '../../src/helpers/runMain.js';

runMain(async () => {
  const config = loadConfig();
  const db = createDb({
    connectionString: config.database.url,
    poolMax: 4,
    applicationName: 'shapio-test-instance',
  });
  const logger = pino({ level: config.log.level });
  const app = await buildApp(config, {
    db,
    logger,
    adminDistPath: null,
    schemaListen: config.schema.listen,
  });
  await app.listen({ host: config.server.host, port: config.server.port });
  const shutdown = () => {
    void app.close().then(() => db.destroy());
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
});
