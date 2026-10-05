/**
 * Compile-time only, never imported: `tsc` (the package's typecheck) fails when the public types declared in
 * `types.ts` drift from the runtime's own. Kept out of the entries so declaration files never reach
 * `@shapio/cms` types.
 */
import type { CallCredentials, DeliveryRuntimeOptions } from '@shapio/cms/delivery';
import type { LocalClientOptions } from './types.js';

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const optionsMatchRuntime: SameType<LocalClientOptions, DeliveryRuntimeOptions & CallCredentials> =
  true;
