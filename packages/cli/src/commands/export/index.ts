import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CliCommand, CliIo } from '../../types.js';
import { formatCounts, scanBundleFile } from './bundleLines.js';
import { bodyOf, describeFailure, parseTransferArgs, send, UsageError, type Connection } from './http.js';
import { BUNDLE_ENTRY, endTar, mediaEntryName, writeTarEntry } from './tar.js';

const USAGE =
  'shapio export [--url <origin>] [--token <admin token>] [--with-media] [--heads-only] [--include-users] <file>';

const FLAGS = ['with-media', 'heads-only', 'include-users'] as const;

const closeStream = (output: Writable) =>
  new Promise<void>((resolveClose, reject) => {
    output.end((error?: Error | null) => (error ? reject(error) : resolveClose()));
  });

/** Downloads one asset's original into the archive, checking it against the manifest on the way. */
const archiveAsset = async (
  connection: Connection,
  output: Writable,
  asset: { id: string; filename: string; sizeBytes: number; sha256: string | null },
) => {
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const response = await send(connection, `/api/admin/transfer/media/${encodeURIComponent(asset.id)}`);
  const body = bodyOf(response).pipe(hashing);
  await writeTarEntry(output, mediaEntryName(asset.id), asset.sizeBytes, body);
  const digest = hash.digest('hex');
  if (asset.sha256 !== null && digest !== asset.sha256) {
    throw new Error(`${asset.filename} (${asset.id}) does not match its checksum in the bundle`);
  }
};

/** Bundle plus media files as one tar archive: `bundle.ndjson`, then `media/<asset id>` per asset. */
const writeArchive = async (connection: Connection, bundlePath: string, out: string, io: CliIo) => {
  const { assets } = await scanBundleFile(bundlePath);
  const output = createWriteStream(out, { mode: 0o600 });
  try {
    await writeTarEntry(output, BUNDLE_ENTRY, (await stat(bundlePath)).size, createReadStream(bundlePath));
    for (const [index, asset] of assets.entries()) {
      await archiveAsset(connection, output, asset);
      if ((index + 1) % 50 === 0) {
        io.stdout(`  ${index + 1}/${assets.length} media files\n`);
      }
    }
    await endTar(output);
  } finally {
    await closeStream(output);
  }
  return assets.length;
};

/**
 * `shapio export`: streams the instance's content bundle (NDJSON) to a file over HTTP with an admin token.
 * `--with-media` writes a tar archive with the bundle and every media file, verified against the manifest.
 */
export const exportCommand: CliCommand = {
  summary:
    'Export schema, locales, roles, content and media metadata to a bundle file (--with-media: tar with files)',
  usage: USAGE,
  run: async (args, io) => {
    let parsed;
    try {
      parsed = parseTransferArgs(args, io, FLAGS);
    } catch (error) {
      if (error instanceof UsageError || error instanceof TypeError) {
        io.stderr(`shapio export: ${error.message}\nUsage: ${USAGE}\n`);
        return 1;
      }
      throw error;
    }
    const { connection, flags, file } = parsed;
    const out = resolve(file);
    const bundlePath = flags['with-media'] ? `${out}.bundle.tmp` : `${out}.tmp`;
    try {
      const response = await send(connection, '/api/admin/transfer/export', {
        query: { headsOnly: flags['heads-only'] === true, includeUsers: flags['include-users'] === true },
      });
      await pipeline(bodyOf(response), createWriteStream(bundlePath, { mode: 0o600 }));
      const { end } = await scanBundleFile(bundlePath);
      if (!end) {
        throw new Error('The export stream ended early (no end record); nothing was written');
      }
      if (flags['with-media']) {
        const files = await writeArchive(connection, bundlePath, `${out}.tmp`, io);
        await rm(bundlePath, { force: true });
        io.stdout(`Archived ${files} media file(s).\n`);
      }
      await rename(`${out}.tmp`, out);
      io.stdout(`Exported ${formatCounts(end.counts)} to ${relative(process.cwd(), out) || out}\n`);
      return 0;
    } catch (error) {
      await rm(bundlePath, { force: true });
      await rm(`${out}.tmp`, { force: true });
      io.stderr(`shapio export: ${describeFailure(error)}\n`);
      return 1;
    }
  },
};
