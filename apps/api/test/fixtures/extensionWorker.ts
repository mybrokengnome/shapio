// Child-process worker for the extension crash tests (package K). Without HANG_AT it is exactly
// `shapio worker` (startDedicatedWorker). With HANG_AT=afterCommit it is the same worker assembly, except that
// an after* hook job, once its transaction committed, logs and hangs before the job is marked succeeded, so
// a SIGKILL leaves a committed hook run behind a job that will be reclaimed and run again.
import { pino } from 'pino';
import { loadConfig } from '../../src/config/index.js';
import { AFTER_HOOK_JOB } from '../../src/constants/extensions.js';
import { createDb } from '../../src/db/index.js';
import { loadProjectConfig } from '../../src/extensions/loader.js';
import { sleep } from '../../src/helpers/sleep.js';
import type { JobHandler } from '../../src/jobs/types.js';
import { createConfiguredWorker, startExtensions } from '../../src/server.js';
import { resolveSigningSecret } from '../../src/services/signingSecret.js';
import { startDedicatedWorker } from '../../src/worker.js';

const config = loadConfig(process.env);

if (process.env.HANG_AT !== 'afterCommit') {
  await startDedicatedWorker(config);
} else {
  const log = pino({ level: 'info' });
  const db = createDb({ connectionString: config.database.url, poolMax: 4 });
  const project = await loadProjectConfig({ configPath: config.extensions.configPath });
  const runtime = await startExtensions(config, db, log, project);
  const jobHandlers = runtime.jobHandlers.map(([type, handler]): [string, JobHandler] => [
    type,
    type === AFTER_HOOK_JOB
      ? async (job) => {
          const result = await handler(job);
          log.info({ result }, 'after hook committed; hanging before the job is marked succeeded');
          await sleep(60_000);
          return result;
        }
      : handler,
  ]);
  const signingSecret = await resolveSigningSecret(db, config.sessionSecret, log);
  (await createConfiguredWorker(config, db, log, signingSecret, { ...runtime, jobHandlers })).start();
}
