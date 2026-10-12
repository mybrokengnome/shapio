import { describeError } from './errors.js';

/**
 * Runs a process entry point. Failures set a non-zero exit code; the message goes to stderr because the
 * logger may not exist yet (for example, invalid configuration). A failure thrown before `main` returns its
 * promise (loading the configuration, say) is reported the same way, not as an uncaught exception.
 */
export const runMain = (main: () => Promise<unknown>): void => {
  Promise.resolve()
    .then(main)
    .catch((error: unknown) => {
      process.stderr.write(`shapio: ${describeError(error)}\n`);
      process.exitCode = 1;
    });
};
