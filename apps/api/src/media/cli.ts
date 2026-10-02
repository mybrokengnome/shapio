import type { CliCommand, CliIo } from '@shapio/cli';
import { loadConfig } from '../config/index.js';
import { createDb } from '../db/index.js';
import { getPendingMigrations } from '../db/migrator.js';
import { createUrlBuilder } from '../helpers/publicUrl.js';
import { migrateMedia } from './migrate.js';
import { createMediaStorage } from './storage.js';
import { STORAGE_DRIVERS, type StorageDriver } from './types.js';

const MEDIA_USAGE =
  'shapio media migrate --from <local|s3> --to <local|s3> [--delete-source]\n' +
  '  Copies every asset and its variants to the other storage, verifies checksums and switches each asset\n' +
  '  over in its own transaction, while the server keeps running. Safe to interrupt and re-run.\n' +
  '  Needs MEDIA_PATH and the STORAGE_S3_* settings. Afterwards set STORAGE_DRIVER to the new driver.';

type MigrateArgs = { from: StorageDriver; to: StorageDriver; deleteSource: boolean };

const isDriver = (value: string | undefined): value is StorageDriver =>
  STORAGE_DRIVERS.includes(value as StorageDriver);

/** `--from x --to y [--delete-source]`, also as `--from=x`. */
const parseMigrateArgs = (args: readonly string[]): MigrateArgs | undefined => {
  const values = new Map<string, string>();
  let deleteSource = false;
  for (let index = 0; index < args.length; index += 1) {
    const match = /^--(from|to|delete-source)(?:=(.*))?$/.exec(args[index] ?? '');
    if (!match?.[1]) {
      return undefined;
    }
    if (match[1] === 'delete-source') {
      deleteSource = true;
      continue;
    }
    const value = match[2] ?? args[index + 1];
    if (match[2] === undefined) {
      index += 1;
    }
    values.set(match[1], value ?? '');
  }
  const from = values.get('from');
  const to = values.get('to');
  return isDriver(from) && isDriver(to) && from !== to ? { from, to, deleteSource } : undefined;
};

const runMigrate = async (parsed: MigrateArgs, io: CliIo): Promise<number> => {
  const config = loadConfig();
  const db = createDb({ connectionString: config.database.url, poolMax: 2, applicationName: 'shapio-media' });
  try {
    if ((await getPendingMigrations(db)).length > 0) {
      io.stderr('Database migrations are pending; run `shapio migrate` (or start the server) first.\n');
      return 1;
    }
    const storage = createMediaStorage(config.storage, { urls: createUrlBuilder(config.server) });
    if (!storage.has('s3')) {
      io.stderr(
        'Set STORAGE_S3_BUCKET (and the other STORAGE_S3_* settings) to migrate media to or from S3.\n',
      );
      return 1;
    }
    const result = await migrateMedia({
      db,
      storage,
      ...parsed,
      report: (line) => io.stdout(`${line}\n`),
    });
    io.stdout(
      `Migrated ${result.migrated}, skipped ${result.skipped} (still processing; re-run later), failed ${result.failed.length}.\n`,
    );
    if (result.migrated > 0 && config.storage.driver !== parsed.to) {
      io.stdout(`Set STORAGE_DRIVER=${parsed.to} and restart so new uploads go to ${parsed.to}.\n`);
    }
    return result.failed.length > 0 ? 1 : 0;
  } finally {
    await db.destroy();
  }
};

/** `shapio media migrate`: runs on the server host (it reads MEDIA_PATH and talks to the database). */
export const mediaCommand: CliCommand = {
  summary: 'Move stored media between local disk and S3 (media migrate --from local --to s3)',
  usage: MEDIA_USAGE,
  run: async (args, io) => {
    const [subcommand, ...rest] = args;
    const parsed = subcommand === 'migrate' ? parseMigrateArgs(rest) : undefined;
    if (!parsed) {
      io.stderr(`Usage: ${MEDIA_USAGE}\n`);
      return 1;
    }
    return runMigrate(parsed, io);
  },
};
