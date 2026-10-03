import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Build output, dependencies, local settings and generated files: never part of a template. */
export const IGNORED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.astro',
  '.next',
  '.svelte-kit',
  '.shapio',
  '.env',
  '.DS_Store',
  'next-env.d.ts',
]);

const isIgnored = (name: string) =>
  IGNORED_NAMES.has(name) || name.endsWith('.tsbuildinfo') || name.endsWith('.log');

/** Every file under `root` (relative paths with `/`, sorted), skipping ignored names at any depth. */
export const listFiles = (root: string, directory = root): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !isIgnored(entry.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [relative(root, path).split('\\').join('/')];
    })
    .sort();
