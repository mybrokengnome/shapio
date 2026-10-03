import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog.js';

describe('parseCatalog', () => {
  it('reads the flat catalog map: quoted and bare names, comments, and nothing outside the block', () => {
    const yaml = [
      'packages:',
      '  - apps/*',
      '',
      '# Versions',
      'catalog:',
      '  # Backend',
      '  fastify: 5.12.5',
      "  '@sveltejs/kit': 2.70.3",
      '  "@types/node": "24.19.1" # pinned',
      '',
      '  next: 16.3.8',
      'allowBuilds:',
      '  esbuild: true',
    ].join('\n');
    expect(parseCatalog(yaml)).toEqual({
      fastify: '5.12.5',
      '@sveltejs/kit': '2.70.3',
      '@types/node': '24.19.1',
      next: '16.3.8',
    });
  });

  it('returns an empty map without a catalog', () => {
    expect(parseCatalog('packages:\n  - apps/*\n')).toEqual({});
  });
});
