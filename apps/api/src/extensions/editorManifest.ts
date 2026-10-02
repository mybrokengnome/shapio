import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The custom field editors a project installs (ADR 0009): built ES modules in `extensions/editors/*.js`,
 * listed by file name in the project's `shapio.config` (`editors: [...]`, loaded by extensions/loader.ts).
 * Read once at startup, so installing an editor is a file copy plus a restart, never a rebuild of the
 * admin. The admin imports each module at runtime through its import map.
 */
export type EditorManifestEntry = {
  /** File name inside `extensions/editors/`. */
  file: string;
  /** Absolute path on disk. */
  path: string;
  /** SHA-256 of the file (hex, shortened): the module URL changes whenever the file does. */
  hash: string;
};

export type EditorManifest = { entries: EditorManifestEntry[] };

export const EDITORS_DIRECTORY = join('extensions', 'editors');
/** Plain file names only: no directories, no traversal. */
export const EDITOR_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.m?js$/;

/** Resolves the listed files against `<projectDir>/extensions/editors`, skipping (and logging) bad entries. */
export const buildEditorManifest = (
  projectDir: string,
  files: readonly unknown[],
  log: FastifyBaseLogger,
): EditorManifest => {
  const directory = resolve(projectDir, EDITORS_DIRECTORY);
  const entries: EditorManifestEntry[] = [];
  for (const file of files) {
    if (typeof file !== 'string' || !EDITOR_FILE_PATTERN.test(file)) {
      log.error({ file }, 'shapio.config editors: expected a .js file name inside extensions/editors');
      continue;
    }
    const path = join(directory, file);
    if (!existsSync(path) || !statSync(path).isFile()) {
      log.error(
        { file, path },
        'shapio.config editors: file not found; build the editor into extensions/editors',
      );
      continue;
    }
    if (entries.some((entry) => entry.file === file)) {
      continue;
    }
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
    entries.push({ file, path, hash });
  }
  return { entries };
};
