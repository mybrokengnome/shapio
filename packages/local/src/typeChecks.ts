/**
 * Compile-time only, never imported: `tsc` (the package's typecheck) fails when the public types declared in
 * `types.ts` drift from the runtime's own. Kept out of the entries so declaration files never reach
 * `@shapio/cms` types.
 */
import type { CallCredentials, DeliveryRuntimeOptions } from '@shapio/cms/delivery';
import type { LocalClientOptions } from './types.js';

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `drafts` is the client's option (it shapes the paths the client sends), not the runtime's. */
export const optionsMatchRuntime: SameType<
  Omit<LocalClientOptions, 'drafts'>,
  DeliveryRuntimeOptions & CallCredentials
> = true;
