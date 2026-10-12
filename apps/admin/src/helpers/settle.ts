export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Awaits a `mutateAsync` call without leaking an unhandled rejection. The failure is not lost: it comes back
 * as `error` (read it here, not from the hook's `mutation.error`, which is only fresh on the next render), the
 * mutation holds it for forms that render it inline, and the MutationCache logs it.
 */
export const settle = async <T>(promise: Promise<T>): Promise<Settled<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
};
