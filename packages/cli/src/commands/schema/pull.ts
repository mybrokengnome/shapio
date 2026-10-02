import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '@shapio/schema';
import type { CliCommand } from '../../types.js';
import { displayPath, removeFile, writeDefinitionFile, writeLockFile } from './files.js';
import { COMMON_USAGE, parseSchemaOptions } from './options.js';
import { apiFor, readLocalState } from './sync.js';

/**
 * `shapio schema pull`: writes every definition of the instance as canonical JSON (one file per model or
 * component) and records what was pulled in the lock file. Refuses to overwrite local edits unless --force.
 */
export const schemaPullCommand: CliCommand = {
  summary: 'Write the instance’s models and components to schema files and the lock file',
  usage: `shapio schema pull ${COMMON_USAGE} [--force]`,
  run: async (args, io) => {
    const options = parseSchemaOptions(args, io);
    const state = await readLocalState(options);
    const edited = state.files.filter((file) => {
      const base = file.id ? state.lock.definitions[file.id] : undefined;
      return !base || file.hash !== base.hash;
    });
    if (edited.length > 0 && !options.force && Object.keys(state.lock.definitions).length > 0) {
      io.stderr(
        `Local schema files have changes that are not on the instance:\n${edited.map((file) => `  ${displayPath(file.path)}`).join('\n')}\n` +
          'Apply them first, or commit them and re-run with --force to overwrite them with the instance’s schema.\n',
      );
      return 1;
    }
    const exported = await apiFor(options).export();
    const lock: LockFile = {
      formatVersion: LOCK_FILE_FORMAT_VERSION,
      schemaVersion: exported.schemaVersion,
      definitions: {},
    };
    const written = new Set<string>();
    for (const { definition, version, hash } of exported.definitions) {
      written.add(await writeDefinitionFile(options.dir, definition));
      lock.definitions[definition.id] = { kind: definition.kind, apiKey: definition.apiKey, version, hash };
    }
    // Files of definitions that no longer exist, or that were renamed, are removed: the directory mirrors the instance.
    for (const file of state.files.filter((candidate) => !written.has(candidate.path))) {
      await removeFile(file.path);
    }
    await writeLockFile(options.lockPath, lock);
    io.stdout(
      `Pulled ${exported.definitions.length} definition(s) at schema version ${exported.schemaVersion} into ${displayPath(options.dir)}\n`,
    );
    return 0;
  },
};
