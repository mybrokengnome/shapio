/** Polls `check` until it returns a value other than undefined/false, or throws after `timeoutMs`. */
export const waitFor = async <T>(
  check: () => Promise<T | undefined | false>,
  { timeoutMs = 10_000, intervalMs = 25 } = {},
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
