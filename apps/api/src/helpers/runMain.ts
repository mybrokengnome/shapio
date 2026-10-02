import { describeError } from './errors.js';

/**
 * Runs a process entry point. Failures set a non-zero exit code; the message goes to stderr because the
 * logger may not exist yet (for example, invalid configuration).
 */
export const runMain = (main: () => Promise<unknown>): void => {
  main().catch((error: unknown) => {
    process.stderr.write(`shapio: ${describeError(error)}\n`);
    process.exitCode = 1;
  });
};
