import type { LinkedValue } from '@/fields/form/context';

/** `#related` (and `?target=<entry ID>`) as the value to go to: `{ path: '/related', entryId }`. */
export const linkedValueOf = (hash: string, target: string | undefined): LinkedValue | undefined => {
  const pointer = decodeURIComponent(hash.replace(/^#/, ''));
  if (pointer === '') {
    return undefined;
  }
  return { path: `/${pointer}`, ...(target ? { entryId: target } : {}) };
};
