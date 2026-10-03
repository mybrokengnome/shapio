type WaitForOptions = {
  /** How long to keep polling. The default leaves room inside the 30 s test timeout; CI is slower than a laptop. */
  timeoutMs?: number;
  intervalMs?: number;
  /** What the test is waiting for, phrased as the thing that should happen ("job X succeeded"). */
  description?: string;
};

/** Formats a duration for a failure message: whole seconds when it is a whole number of seconds. */
export const describeDuration = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

/**
 * Polls `check` until it returns a value other than undefined/false, or throws after `timeoutMs`. The error
 * names what did not happen (`description`), so a failure reads as a sentence, not "expected false to be true".
 */
export const waitFor = async <T>(
  check: () => Promise<T | undefined | false>,
  { timeoutMs = 20_000, intervalMs = 25, description }: WaitForOptions = {},
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(
        description
          ? `Timed out after ${describeDuration(timeoutMs)} waiting for: ${description}`
          : `waitFor timed out after ${describeDuration(timeoutMs)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
