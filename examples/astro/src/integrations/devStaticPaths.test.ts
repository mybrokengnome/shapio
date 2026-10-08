import { describe, expect, it } from 'vitest';
import { DEV_WINDOW_MS } from '../lib/snapshotResolver.js';
import { staticPathsRefresher } from './devStaticPaths.js';

describe('staticPathsRefresher', () => {
  it('clears for a page request at most once per dev read window', () => {
    let time = 0;
    const shouldClear = staticPathsRefresher(() => time);
    expect(shouldClear('/en/articles/a-post/')).toBe(true);
    time += DEV_WINDOW_MS - 1;
    expect(shouldClear('/en/articles/another/')).toBe(false);
    expect(shouldClear('/fr/')).toBe(false);
    time += 1;
    expect(shouldClear('/fr/articles/bonjour/?v=1')).toBe(true);
  });

  it('treats the root and every locale path as a page', () => {
    for (const url of ['/', '/en/', '/en/colophon/', '/fr/a-page/', undefined]) {
      expect(staticPathsRefresher(() => 0)(url)).toBe(true);
    }
  });

  it('ignores tooling and file requests', () => {
    const shouldClear = staticPathsRefresher(() => 0);
    for (const url of [
      '/_astro/x.css',
      '/@vite/client',
      '/@fs/Users/me/node_modules/astro/dist/runtime.js',
      '/@id/astro:scripts/page.js',
      '/src/styles/site.css',
      '/node_modules/.vite/deps/chunk.js',
      '/favicon.svg',
      '/build.json',
      '/en/articles/cover.webp?w=400',
    ]) {
      expect(shouldClear(url)).toBe(false);
    }
    expect(shouldClear('/en/')).toBe(true);
  });
});
