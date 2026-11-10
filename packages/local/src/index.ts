import { createDeliveryClient, resolveWorkspaceOption, type ShapioDeliveryClient } from '@shapio/client';
import * as delivery from '@shapio/cms/delivery';
import { assertNodeRuntime } from './nodeRuntime.js';
import type {
  DeliveryRuntimeError as DeliveryRuntimeErrorInstance,
  LocalClientOptions,
  ShapioVersionSkewError as ShapioVersionSkewErrorInstance,
} from './types.js';

export type { LocalClientOptions } from './types.js';

/** The Shapio release this package reads; the server must run the same one. */
export const SHAPIO_VERSION: string = delivery.SHAPIO_VERSION;

/** Thrown (or 503 `VERSION_SKEW` caught as `ShapioApiError`) when the server runs another release. */
export const ShapioVersionSkewError: {
  new (serverRelease: string | null, libraryRelease: string): ShapioVersionSkewErrorInstance;
  readonly prototype: ShapioVersionSkewErrorInstance;
} = delivery.ShapioVersionSkewError;
export type ShapioVersionSkewError = ShapioVersionSkewErrorInstance;

/** Thrown by `createLocalClient` for options it cannot serve (SQLite, an unknown URL, a second database). */
export const DeliveryRuntimeError: {
  new (message: string): DeliveryRuntimeErrorInstance;
  readonly prototype: DeliveryRuntimeErrorInstance;
} = delivery.DeliveryRuntimeError;
export type DeliveryRuntimeError = DeliveryRuntimeErrorInstance;

export type LocalClient = ShapioDeliveryClient & {
  /**
   * Stops this client. The database pool is shared by every local client of the process and closes when the
   * last one is closed. Long-running servers never need to call it; scripts and tests do.
   */
  close: () => Promise<void>;
};

/**
 * Shapio's delivery API as function calls in this process: the `delivery`, `workspace` (also as `site`) and
 * `snapshots` groups of `@shapio/client`, with the same paths, permissions, response shapes and
 * `ShapioApiError`s, answered from the database without an HTTP hop. Reads as `token` (a delivery API token)
 * or, without one, as an anonymous caller (the workspace's `public` role). Model changes made in the admin
 * show on the next call. `drafts: true` reads drafts instead (drafts mode), when the token's role grants Read
 * drafts. `schemaVersion` reads in the shape of the schema version the site was built against.
 *
 * Needs PostgreSQL or MySQL, the Node.js runtime, and the same Shapio release as the server (`SHAPIO_VERSION`);
 * see `onVersionSkew`. Nothing is read until the first call.
 */
export const createLocalClient = ({
  token,
  workspace,
  site: siteOption,
  drafts,
  schemaVersion,
  ...runtimeOptions
}: LocalClientOptions): LocalClient => {
  assertNodeRuntime();
  const site = resolveWorkspaceOption(
    { workspace, site: siteOption },
    'createLocalClient',
    (message) => new DeliveryRuntimeError(message),
  );
  const runtime = delivery.createDeliveryRuntime(runtimeOptions);
  const release = runtime.retain();
  const request = delivery.createInProcessRequest(runtime, {
    ...(token !== undefined ? { token } : {}),
    ...(site !== undefined ? { site } : {}),
  });
  return {
    ...createDeliveryClient(request, {
      ...(site !== undefined ? { site } : {}),
      ...(drafts !== undefined ? { drafts } : {}),
      // In the path, so the in-process read and its HTTP fallback both receive it.
      ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    }),
    close: release,
  };
};
