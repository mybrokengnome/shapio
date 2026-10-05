import { createClient, type ShapioDeliveryClient } from '@shapio/client';
import { createLocalClient } from '@shapio/local';
import { databaseUrl, deliveryToken, shapioMode, shapioUrl, siteKey } from './config';

/**
 * The client the site reads with: Shapio's delivery API over HTTP (SHAPIO_MODE=http, the default), or the same
 * API in this process (SHAPIO_MODE=in-process, `@shapio/local`), reading Shapio's database directly. Both
 * expose the same `delivery`, `site` and `snapshots` calls and answer them identically, with the same delivery
 * token deciding what the site may read.
 */
export const createShapioClient = (): ShapioDeliveryClient & { close?: () => Promise<void> } => {
  const site = siteKey();
  if (shapioMode() === 'in-process') {
    return createLocalClient({ databaseUrl: databaseUrl(), token: deliveryToken(), site });
  }
  return createClient({ baseUrl: shapioUrl(), token: deliveryToken(), site });
};
