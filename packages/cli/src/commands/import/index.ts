import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@shapio/client';
import type { CliCommand, CliIo } from '../../types.js';
import {
  describeFailure,
  parseTransferArgs,
  send,
  sendJson,
  UsageError,
  type Connection,
} from '../export/http.js';
import { BUNDLE_ENTRY, isTar, listTar, mediaEntryName, type TarEntry } from '../export/tar.js';
import { formatPlan, type ImportDiff, type MediaFileNeed } from './plan.js';

const USAGE =
  'shapio import [--url <origin>] [--token <admin token>] [--dry-run] [--prune] [--no-wait] <file>\n' +
  '  Plans the import (--dry-run stops there) and refuses it, writing nothing, on any conflict.\n' +
  '  An import never changes an existing model: a model the target has in another form is a conflict.\n' +
  "  Reconcile the schema first: `shapio schema pull` from the target, merge the bundle's models into the\n" +
  '  files (git diff), `shapio schema apply`, then import again.';
const FLAGS = ['dry-run', 'prune', 'no-wait'] as const;
const POLL_INTERVAL_MS = 1000;
const BUNDLE_CONTENT_TYPE = 'application/x-ndjson';

type Source = { open: () => ReturnType<typeof createReadStream>; media: Map<string, TarEntry> | undefined };

type ImportCounts = Record<string, Record<string, number> | number>;

type ImportStatus = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'dead';
  attempts: number;
  lastError: string | null;
  progress: {
    phase?: string;
    counts?: ImportCounts;
    errors?: Array<{ id: string; code: string; message: string }>;
    errorCount?: number;
  } | null;
};

/** A plain NDJSON bundle, or a `--with-media` tar archive (bundle + media files). */
const openSource = async (path: string): Promise<Source> => {
  if (!(await isTar(path))) {
    await stat(path);
    return { open: () => createReadStream(path), media: undefined };
  }
  const entries = await listTar(path);
  const bundle = entries.get(BUNDLE_ENTRY);
  if (!bundle) {
    throw new Error(`${path} is a tar archive without ${BUNDLE_ENTRY}`);
  }
  return {
    open: () => createReadStream(path, { start: bundle.offset, end: bundle.offset + bundle.size - 1 }),
    media: entries,
  };
};

const rangeOf = (path: string, entry: TarEntry) => () =>
  createReadStream(path, { start: entry.offset, end: entry.offset + entry.size - 1 });

const sha256Of = async (open: () => NodeJS.ReadableStream) => {
  const hash = createHash('sha256');
  for await (const chunk of open()) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
};

const postBundle = (connection: Connection, source: Source, query: Record<string, boolean>) =>
  sendJson<{
    dryRun: boolean;
    diff: ImportDiff;
    importId?: string;
    webhookSecrets?: Array<{ name: string; secret: string }>;
  }>(connection, '/api/admin/transfer/import', {
    method: 'POST',
    query,
    body: source.open,
    contentType: BUNDLE_CONTENT_TYPE,
  });

/** Uploads the files the plan needs from the archive, each verified by the server against the manifest. */
const uploadMedia = async (
  connection: Connection,
  path: string,
  source: Source,
  files: readonly MediaFileNeed[],
  io: CliIo,
) => {
  if (files.length === 0) {
    return;
  }
  if (!source.media) {
    io.stdout(
      `${files.length} media file(s) are not in this bundle: they must already be in the target's storage under their keys (or re-export with --with-media).\n`,
    );
    return;
  }
  let uploaded = 0;
  for (const file of files) {
    const entry = source.media.get(mediaEntryName(file.assetId));
    if (!entry) {
      io.stderr(`  missing in the archive: media/${file.assetId}\n`);
      continue;
    }
    const open = rangeOf(path, entry);
    await send(connection, `/api/admin/transfer/media/${encodeURIComponent(file.assetId)}`, {
      method: 'PUT',
      query: {
        storageKey: file.storageKey,
        sha256: file.sha256 ?? (await sha256Of(open)),
        sizeBytes: entry.size,
        mimeType: file.mimeType,
      },
      body: open,
      contentType: 'application/octet-stream',
    });
    uploaded += 1;
  }
  io.stdout(`Uploaded ${uploaded} media file(s).\n`);
};

type Tally = Partial<Record<'added' | 'updated' | 'unchanged', number>>;

const tally = (value: Tally | number | undefined) =>
  typeof value === 'object'
    ? (['added', 'updated', 'unchanged'] as const)
        .filter((kind) => value[kind] !== undefined)
        .map((kind) => `${value[kind]} ${kind}`)
        .join(', ')
    : String(value ?? 0);

/** The job's counts in a fixed, readable order. */
const formatCounts = (counts: ImportCounts | undefined) =>
  [
    `entries: ${tally(counts?.entries)}`,
    `media: ${tally(counts?.media)}`,
    `app users: ${tally(counts?.users)}`,
    `pruned entries: ${tally(counts?.pruned)}`,
  ].join('; ');

/** Polls the import job until it finished, printing each phase once. */
const waitForImport = async (connection: Connection, importId: string, io: CliIo): Promise<number> => {
  const client = createClient(connection);
  let phase: string | undefined;
  for (;;) {
    const status = await client.request<ImportStatus>(
      `/api/admin/transfer/imports/${encodeURIComponent(importId)}`,
    );
    const current = status.progress?.phase;
    if (current && current !== phase && status.status !== 'succeeded') {
      phase = current;
      io.stdout(`  ${current}...\n`);
    }
    if (status.status === 'dead') {
      io.stderr(
        `The import failed after ${status.attempts} attempt(s): ${status.lastError ?? 'unknown error'}\n`,
      );
      return 1;
    }
    if (status.status === 'succeeded') {
      const errors = status.progress?.errors ?? [];
      io.stdout(`Imported. ${formatCounts(status.progress?.counts)}.\n`);
      for (const error of errors.slice(0, 20)) {
        io.stderr(`  ! ${error.id}: ${error.code}: ${error.message}\n`);
      }
      const errorCount = status.progress?.errorCount ?? 0;
      if (errorCount > 0) {
        io.stderr(
          `${errorCount} item(s) were not imported (see above, and the job in Admin → Publishing → Jobs).\n`,
        );
        return 1;
      }
      return 0;
    }
    await delay(POLL_INTERVAL_MS);
  }
};

/**
 * `shapio import`: plans the import on the instance (a dry run), refuses on conflicts, uploads the media
 * files a `--with-media` archive carries, then starts the import job and follows it to the end.
 */
export const importCommand: CliCommand = {
  summary: 'Import a bundle: plan (--dry-run), refuse on conflicts, then import as a resumable job',
  usage: USAGE,
  run: async (args, io) => {
    let parsed;
    try {
      parsed = parseTransferArgs(args, io, FLAGS);
    } catch (error) {
      if (error instanceof UsageError || error instanceof TypeError) {
        io.stderr(`shapio import: ${error.message}\nUsage: ${USAGE}\n`);
        return 1;
      }
      throw error;
    }
    const { connection, flags, file } = parsed;
    try {
      const source = await openSource(file);
      const prune = flags.prune === true;
      const planned = await postBundle(connection, source, { dryRun: true, prune });
      io.stdout(formatPlan(planned.diff));
      if (flags['dry-run'] || planned.diff.conflicts > 0) {
        return planned.diff.conflicts > 0 ? 1 : 0;
      }
      await uploadMedia(connection, file, source, planned.diff.media.files, io);
      const started = await postBundle(connection, source, { dryRun: false, prune });
      for (const webhook of started.webhookSecrets ?? []) {
        io.stdout(
          `Webhook "${webhook.name}" was imported disabled with a new signing secret: ${webhook.secret}\n`,
        );
      }
      io.stdout(`Import ${started.importId ?? ''} started.\n`);
      if (flags['no-wait'] || !started.importId) {
        return 0;
      }
      return await waitForImport(connection, started.importId, io);
    } catch (error) {
      io.stderr(`shapio import: ${describeFailure(error)}\n`);
      return 1;
    }
  },
};
