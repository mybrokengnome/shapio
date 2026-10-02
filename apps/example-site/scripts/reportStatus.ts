import { CALLBACK_STATUSES, sendCallback, type CallbackStatus } from './lib/callback.js';

/**
 * `pnpm --filter example-site report-status <building|deployed|failed> [message]`: tells Shapio how the build
 * of a deployment run went (generic webhook connections). Run it from the build pipeline that Shapio's
 * trigger started, with:
 *   SHAPIO_CALLBACK_URL    the trigger's `callbackUrl`
 *   SHAPIO_RUN_ID          the trigger's `runId`
 *   SHAPIO_CALLBACK_SECRET the connection's signing secret (shown once when the connection was created)
 *   SITE_URL, BUILD_LOG_URL optional links shown on the run in the admin
 */
const main = async () => {
  const [status, ...words] = process.argv.slice(2);
  if (!CALLBACK_STATUSES.includes(status as CallbackStatus)) {
    throw new Error(`Usage: report-status <${CALLBACK_STATUSES.join('|')}> [message]`);
  }
  const { SHAPIO_CALLBACK_URL: url, SHAPIO_RUN_ID: runId, SHAPIO_CALLBACK_SECRET: secret } = process.env;
  if (!url || !runId || !secret) {
    throw new Error(
      'Set SHAPIO_CALLBACK_URL, SHAPIO_RUN_ID and SHAPIO_CALLBACK_SECRET (from the trigger and the connection)',
    );
  }
  const result = await sendCallback(url, secret, {
    runId,
    status: status as CallbackStatus,
    ...(process.env.SITE_URL ? { siteUrl: process.env.SITE_URL } : {}),
    ...(process.env.BUILD_LOG_URL ? { logUrl: process.env.BUILD_LOG_URL } : {}),
    ...(words.length > 0 ? { message: words.join(' ') } : {}),
  });
  process.stdout.write(
    result.applied
      ? `Run ${runId} is now ${result.status}\n`
      : `Ignored by Shapio: run ${runId} is already ${result.status}\n`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`report-status: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
