import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TemplateError } from './rewrite.js';

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

/**
 * Files `npm run types` writes against a local instance (relative to the starter): its types are that
 * instance's schema, never the template's.
 */
export const IGNORED_PATHS: ReadonlySet<string> = new Set(['src/lib/shapio.generated.ts']);

/** The starters' schema version module: shipped naming no version (today's schema). */
export const SCHEMA_VERSION_MODULE_PATH = 'src/lib/schemaVersion.ts';

const UNPINNED_SCHEMA_VERSION = /^export const SCHEMA_VERSION(?::[^=]+)?=\s*undefined;\s*$/m;

const isIgnored = (name: string) =>
  IGNORED_NAMES.has(name) || name.endsWith('.tsbuildinfo') || name.endsWith('.log');

const relativePath = (root: string, path: string) => relative(root, path).split('\\').join('/');

/** Every file under `root` (relative paths with `/`, sorted), skipping ignored names at any depth. */
export const listFiles = (root: string, directory = root): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        !isIgnored(entry.name) && !IGNORED_PATHS.has(relativePath(root, join(directory, entry.name))),
    )
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [relativePath(root, path)];
    })
    .sort();

/**
 * Refuses a schema version module that names a version: `npm run types` against a local instance writes that
 * instance's `<schemaId>:<version>` into it, which would make every new project ask another instance for it
 * (`400 SCHEMA_VERSION_FOREIGN`).
 */
export const checkSchemaVersionModule = (label: string, path: string, content: string) => {
  if (path === SCHEMA_VERSION_MODULE_PATH && !UNPINNED_SCHEMA_VERSION.test(content)) {
    throw new TemplateError(
      `${label}/${path} names a schema version; a template must export SCHEMA_VERSION as undefined (restore it with git checkout)`,
    );
  }
};
