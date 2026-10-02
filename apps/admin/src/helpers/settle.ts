export type Settled<T> = { ok: true; value: T } | { ok: false };

/**
 * Awaits a `mutateAsync` call without leaking an unhandled rejection. The failure is not lost: the mutation
 * holds it (forms render `mutation.error` inline) and the MutationCache logs it.
 */
export const settle = async <T>(promise: Promise<T>): Promise<Settled<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch {
    return { ok: false };
  }
};
