import { setTimeout as delay } from 'node:timers/promises';
import type { SchemaApplyResult, SchemaSyncResult } from '@shapio/client';
import { upgradeLockFile, type ScopedLockFile } from '@shapio/schema';
import type { CliCommand, CliIo } from '../../types.js';
import { removeFile, writeDefinitionFile, writeLockFile } from './files.js';
import { COMMON_USAGE, parseSchemaOptions, type SchemaCommandOptions } from './options.js';
import { coverSiteIfHeld } from './siteTree.js';
import { apiFor, printResults, readSiteState, sendApply, type SiteState } from './sync.js';

const POLL_INTERVAL_MS = 500;

/** Waits for planned changes (prerequisite jobs) to activate or fail. Returns the failed ones. */
const waitForChanges = async (
  options: SchemaCommandOptions,
  items: readonly SchemaSyncResult[],
  io: CliIo,
) => {
  const api = apiFor(options);
  const deadline = Date.now() + options.waitTimeoutMs;
  const failed: SchemaSyncResult[] = [];
  for (const item of items) {
    io.stdout(`Waiting for ${item.apiKey} (change ${item.changeId ?? ''})...\n`);
    for (;;) {
      const change = await api.change(item.changeId ?? '');
      if (change.status === 'activated') {
        item.outcome = 'activated';
        break;
      }
      if (change.status === 'failed' || change.status === 'cancelled') {
        io.stderr(`${item.apiKey}: change ${change.status}: ${JSON.stringify(change.error)}\n`);
        failed.push(item);
        break;
      }
      if (Date.now() > deadline) {
        io.stderr(
          `${item.apiKey}: still ${change.status} after the wait timeout; check it later in the admin.\n`,
        );
        failed.push(item);
        break;
      }
      await delay(POLL_INTERVAL_MS);
    }
  }
  return failed;
};

/**
 * Records the new state in the lock file and rewrites the files of applied definitions in canonical form
 * (e.g. with server-assigned field IDs), in their scope's folder. Definitions skipped because they were
 * unchanged locally keep their old base, so a later apply still treats them as untouched. Other sites'
 * entries are kept as they are.
 */
const updateLocalState = async (
  options: SchemaCommandOptions,
  state: SiteState,
  response: SchemaApplyResult,
) => {
  const exported = await apiFor(options).export();
  const remote = new Map(exported.definitions.map((entry) => [entry.definition.id, entry]));
  const upgraded = upgradeLockFile(state.lock);
  const lock: ScopedLockFile = {
    ...upgraded,
    schemaVersion: exported.schemaVersion,
    definitions: { ...upgraded.definitions },
  };
  for (const item of response.results) {
    const settled =
      item.outcome === 'activated' ||
      (item.decision.action === 'skip' && item.decision.reason === 'alreadyApplied');
    if (!settled) {
      continue;
    }
    const entry = remote.get(item.definitionId);
    if (!entry) {
      delete lock.definitions[item.definitionId];
      continue;
    }
    const previous = state.sent.find((file) => file.id === item.definitionId);
    const path = await writeDefinitionFile(options.dir, entry.definition, entry.site);
    if (previous && previous.path !== path) {
      await removeFile(previous.path);
    }
    lock.definitions[item.definitionId] = {
      kind: entry.definition.kind,
      apiKey: entry.definition.apiKey,
      version: entry.version,
      hash: entry.hash,
      site: entry.site,
    };
  }
  await writeLockFile(options.lockPath, coverSiteIfHeld(lock, state.siteKey));
};

/**
 * `shapio schema apply`: applies local schema files to a running instance live, through the same planner as
 * the admin UI. Three-way per definition against the lock file; refuses (and changes nothing) on conflicts.
 * It sends the shared files and the site's own (`sites/<key>/`), never another site's.
 */
export const schemaApplyCommand: CliCommand = {
  summary: 'Apply local schema files to the instance live (three-way, per model; refuses on conflicts)',
  usage: `shapio schema apply ${COMMON_USAGE} [--prune] [--allow-breaking] [--allow-destructive] [--no-wait] [--wait-timeout <s>]`,
  run: async (args, io) => {
    const options = parseSchemaOptions(args, io);
    const state = await readSiteState(options, io);
    if (!state) {
      return 1;
    }
    const response = await sendApply(options, state, false, io);
    if (!response) {
      return 1;
    }
    printResults(response, state, io, false);
    const pending = response.results.filter((item) => item.outcome === 'pending');
    const failed = options.wait ? await waitForChanges(options, pending, io) : [];
    await updateLocalState(options, state, response);
    const applied = response.results.filter((item) => item.outcome === 'activated').length;
    io.stdout(`Applied ${applied} definition(s) at schema version ${response.schemaVersion}.\n`);
    return failed.length > 0 ? 1 : 0;
  },
};
