import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The in-process delivery entry loads only the read path (plan next-in-process §2): code beside a site
 * (a Next.js server, a serverless function) must not load the HTTP server, the admin's password hashing,
 * image processing or email, and loads the MySQL driver and the AWS SDK only when it needs them. This walks
 * the entry's static runtime imports (type-only imports are erased; `import()` is lazy) and checks the
 * packages they reach.
 */
const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts');

/** Never loaded by the entry, statically or lazily. */
const FORBIDDEN = [
  /^fastify$/,
  /^fastify-plugin$/,
  /^@fastify\//,
  /^@node-rs\/argon2$/,
  /^sharp$/,
  /^nodemailer$/,
  /^env-schema$/,
  /^close-with-grace$/,
];

/** Loaded only on demand (`import()`), never by a static import. */
const LAZY_ONLY = [/^mysql2$/, /^@aws-sdk\//];

type ImportsOf = { staticImports: string[]; lazyImports: string[] };

const STATEMENT = /^\s*(import|export)\s+([\s\S]*?)\s*from\s*'([^']+)';?/gm;
const SIDE_EFFECT = /^\s*import\s+'([^']+)';?/gm;
const DYNAMIC = /\bimport\(\s*'([^']+)'\s*\)/g;

const importsOf = (source: string): ImportsOf => {
  const staticImports: string[] = [];
  for (const [, , clause = '', specifier = ''] of source.matchAll(STATEMENT)) {
    // `import type { … }` and `export type { … }` are erased; `import { type A, b }` still loads the module.
    if (/^type\s/.test(clause)) {
      continue;
    }
    staticImports.push(specifier);
  }
  for (const [, specifier = ''] of source.matchAll(SIDE_EFFECT)) {
    staticImports.push(specifier);
  }
  const lazyImports = [...source.matchAll(DYNAMIC)].map(([, specifier = '']) => specifier);
  return { staticImports, lazyImports };
};

const resolveLocal = (from: string, specifier: string): string => {
  const path = resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));
  if (!existsSync(path)) {
    throw new Error(`${specifier} imported from ${from} does not resolve to a .ts file`);
  }
  return path;
};

/** Every package the entry reaches through static imports of its own files, and those it loads lazily. */
const walk = (entry: string) => {
  const seen = new Set<string>();
  const staticPackages = new Set<string>();
  const lazyPackages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const { staticImports, lazyImports } = importsOf(readFileSync(file, 'utf8'));
    for (const specifier of staticImports) {
      if (specifier.startsWith('.')) {
        queue.push(resolveLocal(file, specifier));
      } else {
        staticPackages.add(specifier);
      }
    }
    for (const specifier of lazyImports) {
      if (!specifier.startsWith('.')) {
        lazyPackages.add(specifier);
        continue;
      }
      // A lazily loaded module's own static imports load with it, lazily.
      const { staticImports: lazyStatic } = importsOf(readFileSync(resolveLocal(file, specifier), 'utf8'));
      lazyStatic.filter((name) => !name.startsWith('.')).forEach((name) => lazyPackages.add(name));
    }
  }
  return { files: seen.size, staticPackages: [...staticPackages], lazyPackages: [...lazyPackages] };
};

describe('in-process delivery import graph', () => {
  const graph = walk(ENTRY);

  it('reaches the read path through its own files', () => {
    expect(graph.files).toBeGreaterThan(50);
    expect(graph.staticPackages).toEqual(expect.arrayContaining(['kysely', 'pg', '@shapio/client']));
  });

  it('never loads the HTTP server, password hashing, image processing or email', () => {
    const all = [...graph.staticPackages, ...graph.lazyPackages];
    expect(all.filter((name) => FORBIDDEN.some((pattern) => pattern.test(name)))).toEqual([]);
  });

  it('loads the MySQL driver and the AWS SDK only on demand', () => {
    expect(graph.staticPackages.filter((name) => LAZY_ONLY.some((pattern) => pattern.test(name)))).toEqual(
      [],
    );
    expect(graph.lazyPackages).toEqual(expect.arrayContaining(['mysql2', '@aws-sdk/client-s3']));
  });
});
