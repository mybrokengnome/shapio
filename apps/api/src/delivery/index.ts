/**
 * In-process delivery (plan next-in-process §2): the delivery API's reads as function calls, for code that
 * runs beside the database (a Next.js server, an SSR site, a script). Workspace-internal entry
 * (`@shapio/cms/delivery`, source condition only); `@shapio/local` bundles and publishes it.
 */
export { SHAPIO_VERSION } from '../constants/version.js';
export { DeliveryRuntimeError, ShapioVersionSkewError } from './errors.js';
export {
  createInProcessRequest,
  matchDeliveryRequest,
  type DeliveryRoute,
  type MatchedRequest,
} from './request.js';
export { createDeliveryRuntime, type DeliveryRuntime, type DeliveryRuntimeOptions } from './runtime.js';
export type { CallCredentials } from './scope.js';
