import { assertNodeRuntime } from './nodeRuntime.js';

/**
 * Next.js helpers for `@shapio/local`. Importing this module from an Edge route fails at once with an
 * explanation (in-process reads need the Node.js runtime).
 *
 * Add the package to `serverExternalPackages` in `next.config.ts`, so Next loads it from `node_modules` once
 * per process instead of bundling a copy per route (each copy would open its own database pool):
 *
 * ```ts
 * const nextConfig: NextConfig = { serverExternalPackages: ['@shapio/local'] };
 * ```
 *
 * Caching. In-process reads do not go through `fetch`, so Next's data cache does not see them, and the cache
 * options `@shapio/client` accepts have no effect here. Cache a read where you call it, tagged with
 * `shapioTags`, the same tags HTTP reads carry, so your `/api/revalidate` route's `revalidateTag` calls refresh
 * both. With `cacheComponents` on:
 *
 * ```ts
 * import { cacheTag } from 'next/cache';
 * import { shapioTags } from '@shapio/local/next';
 *
 * export const getArticles = async (locale: string) => {
 *   'use cache';
 *   cacheTag(shapioTags.site(), shapioTags.model('articles'));
 *   return (await shapio.delivery.list<Article>('articles', { locale })).data;
 * };
 * ```
 *
 * Without `cacheComponents`, wrap the read in `unstable_cache(read, [key], { tags: [...] })` instead.
 * `cacheTag()` cannot be called for you: on Next.js 16.3 it throws unless `cacheComponents` is on (E886) and
 * anywhere outside a `"use cache"` function (E819), including inside `unstable_cache` and plain route
 * handlers.
 */
assertNodeRuntime();

export { shapioTags } from '@shapio/client';
export { assertNodeRuntime } from './nodeRuntime.js';
