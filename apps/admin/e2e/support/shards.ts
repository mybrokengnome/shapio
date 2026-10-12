import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CI runs the suite in three shards per database (SHAPIO_E2E_SHARD=1, 2 or 3), split by measured time rather
 * than test count: Playwright's own `--shard` keeps files in name order and left one shard twice as long as
 * the others. Shards 1 and 2 run the files listed here; shard 3 runs every other spec, so a new spec file is
 * never skipped. admin1Setup must open shard 1 (it expects first-run setup to be pending) and admin3Team and
 * admin4Auth must share a shard (the invite link). Unset, the whole suite runs as one, as the local gate does.
 */
export const LISTED_SHARDS: readonly (readonly string[])[] = [
  [
    'admin1Setup.spec.ts',
    'admin2Shell.spec.ts',
    'admin3Team.spec.ts',
    'admin4Auth.spec.ts',
    'appearance.spec.ts',
    'appUsers.spec.ts',
    'assist.spec.ts',
    'changeSets.spec.ts',
    'codeField.spec.ts',
    'develop.spec.ts',
    'entryEmptyFields.spec.ts',
    'entryForm.spec.ts',
    'entryPlacement.spec.ts',
  ],
  [
    'content.spec.ts',
    'entryDocument.spec.ts',
    'graphql.spec.ts',
    'inbox.spec.ts',
    'keyboardContent.spec.ts',
    'keyboardMedia.spec.ts',
  ],
];
export const SHARD_COUNT = LISTED_SHARDS.length + 1;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileMatchers = (files: readonly string[]) =>
  files.map((file) => new RegExp(`[\\\\/]${escapeRegExp(file)}$`));

/** The Playwright `testMatch`/`testIgnore` options for the shard named by `shard`, or none when it is unset. */
export const shardFilter = (testDir: string, shard: string | undefined) => {
  if (shard === undefined || shard === '') {
    return {};
  }
  const index = Number(shard);
  if (!Number.isInteger(index) || index < 1 || index > SHARD_COUNT) {
    throw new Error(`SHAPIO_E2E_SHARD must be 1 to ${SHARD_COUNT}, got "${shard}"`);
  }
  const listed = LISTED_SHARDS.flat();
  const missing = listed.filter((file) => !existsSync(join(testDir, file)));
  if (missing.length > 0) {
    throw new Error(`e2e/support/shards.ts lists spec files that do not exist: ${missing.join(', ')}`);
  }
  const files = LISTED_SHARDS[index - 1];
  return files ? { testMatch: fileMatchers(files) } : { testIgnore: fileMatchers(listed) };
};
