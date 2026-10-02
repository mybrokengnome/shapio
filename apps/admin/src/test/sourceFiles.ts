import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SRC_DIR = join(import.meta.dirname, '..');

/** Every non-test source file under src/ with the given extensions, as { path (relative), text }. */
export const readSourceFiles = (extensions: readonly string[]) =>
  readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
    .filter((path) => extensions.some((extension) => path.endsWith(extension)))
    .filter((path) => !/\.test\.tsx?$/.test(path) && !path.startsWith('test/'))
    .map((path) => ({
      path: relative(SRC_DIR, join(SRC_DIR, path)),
      text: readFileSync(join(SRC_DIR, path), 'utf8'),
    }));
