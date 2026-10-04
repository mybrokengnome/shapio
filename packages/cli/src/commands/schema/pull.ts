import { mergePulledLock } from '@shapio/schema';
import type { CliCommand } from '../../types.js';
import { displayPath, removeFile, writeDefinitionFile, writeLockFile } from './files.js';
import { COMMON_USAGE, parseSchemaOptions } from './options.js';
import { editedFilesForSite, staleFilesAfterPull } from './siteTree.js';
import { apiFor, readLocalState } from './sync.js';

/**
 * `shapio schema pull`: writes one site's view of the instance (the shared definitions in `models/` and
 * `components/`, the site's own under `sites/<key>/`) as canonical JSON, one file per model or component,
 * and records what was pulled in the lock file. Another site's folder and lock entries are left alone, so one
 * tree can hold several sites. Refuses to overwrite local edits in the pulled folders unless --force.
 */
export const schemaPullCommand: CliCommand = {
  summary: 'Write a site’s models and components (shared and its own) to schema files and the lock file',
  usage: `shapio schema pull ${COMMON_USAGE} [--force]`,
  run: async (args, io) => {
    const options = parseSchemaOptions(args, io);
    const exported = await apiFor(options).export();
    if (!exported.site) {
      throw new Error('The instance did not say which site this view is; pass --site <key>');
    }
    const siteKey = exported.site.key;
    const state = await readLocalState(options);
    const edited = editedFilesForSite(state.files, state.lock, siteKey);
    if (edited.length > 0 && !options.force) {
      io.stderr(
        `Local schema files have changes that are not on the instance:\n${edited.map((file) => `  ${displayPath(file.path)}`).join('\n')}\n` +
          'Apply them first, or commit them and re-run with --force to overwrite them with the instance’s schema.\n',
      );
      return 1;
    }
    const written = new Map<string, string>();
    for (const { definition, site } of exported.definitions) {
      written.set(definition.id, await writeDefinitionFile(options.dir, definition, site));
    }
    // The pulled folders mirror the instance: files of definitions that no longer exist, were renamed or
    // moved to another scope are removed. Another site's folder is never touched.
    for (const file of staleFilesAfterPull(state.files, siteKey, written)) {
      await removeFile(file.path);
    }
    await writeLockFile(
      options.lockPath,
      mergePulledLock(state.lock, {
        schemaVersion: exported.schemaVersion,
        siteKey,
        definitions: exported.definitions,
      }),
    );
    io.stdout(
      `Pulled ${exported.definitions.length} definition(s) of site "${siteKey}" at schema version ${exported.schemaVersion} into ${displayPath(options.dir)}\n`,
    );
    return 0;
  },
};
