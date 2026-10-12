import { setImmediate as nextMacrotask } from 'node:timers/promises';

/**
 * Starts `count` requests that are all in flight together, each started on its own turn of the event loop.
 * Starting them in the same tick would make @fastify/rate-limit's per-IP hook reject them all: its in-memory
 * store hands every caller the same entry object, read after an `await`, so each sees the final count.
 */
export const startEach = async <T>(count: number, start: (index: number) => Promise<T>): Promise<T[]> => {
  const pending: Promise<T>[] = [];
  for (let index = 0; index < count; index += 1) {
    pending.push(start(index));
    await nextMacrotask();
  }
  return Promise.all(pending);
};
