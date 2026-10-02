import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import type { Database } from '../../src/db/index.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';
import { createMediaJobHandlers } from '../../src/media/jobs.js';
import { silentLogger } from './silentLogger.js';
import { waitFor } from './waitFor.js';

export type UploadGrantBody = {
  grantId: string;
  assetId: string;
  maxSizeBytes: number;
  upload: { method: 'POST'; url: string; fields: Record<string, string>; fileField: 'file' };
};

export type MediaAssetBody = {
  id: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  visibility: 'public' | 'private';
  status: 'processing' | 'ready' | 'failed';
  storageDriver: 'local' | 's3';
  url: string;
  urlExpiresAt: string | null;
  version: number;
  variants: { name: string; status: string; url: string | null; width: number | null; mimeType: string }[];
};

export type Headers = Record<string, string>;

/** A PNG of the given size (a gradient, so variants are not trivially tiny). */
export const createPng = (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 37, g: 99, b: 235 } } })
    .png()
    .toBuffer();

/** The multipart form a browser would send for an upload grant: its fields first, then the file. */
export const buildUploadForm = (grant: UploadGrantBody, file: Buffer, filename: string): FormData => {
  const form = new FormData();
  for (const [name, value] of Object.entries(grant.upload.fields)) {
    form.append(name, value);
  }
  form.append(
    grant.upload.fileField,
    new Blob([new Uint8Array(file)], { type: grant.upload.fields['Content-Type'] }),
    filename,
  );
  return form;
};

/** Sends a form through `app.inject` (local driver: the upload URL is Shapio's own route). */
export const injectForm = async (
  app: FastifyInstance,
  url: string,
  form: FormData,
): Promise<LightMyRequestResponse> => {
  const request = new Request(url, { method: 'POST', body: form });
  return app.inject({
    method: 'POST',
    url: new URL(url).pathname,
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
    payload: Buffer.from(await request.arrayBuffer()),
  });
};

export const requestGrant = async (
  app: FastifyInstance,
  headers: Headers,
  body: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    visibility?: 'public' | 'private';
    folderId?: string | null;
  },
) => app.inject({ method: 'POST', url: '/api/admin/media/uploads', headers, payload: body });

export const confirmGrant = (app: FastifyInstance, headers: Headers, grantId: string) =>
  app.inject({ method: 'POST', url: `/api/admin/media/uploads/${grantId}/confirm`, headers });

type UploadInput = {
  file: Buffer;
  filename: string;
  mimeType: string;
  visibility?: 'public' | 'private';
  folderId?: string | null;
};

/**
 * The client flow for both drivers: grant → POST the form to `upload.url` → confirm. The form goes through
 * `app.inject` when the URL is Shapio's own route and over the network (fetch) when it is a bucket.
 */
export const uploadThroughGrant = async (
  app: FastifyInstance,
  headers: Headers,
  input: UploadInput,
): Promise<{
  grant: UploadGrantBody;
  upload: { status: number; body: string };
  confirm: LightMyRequestResponse;
}> => {
  const grantResponse = await requestGrant(app, headers, {
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.file.length,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
  });
  if (grantResponse.statusCode !== 201) {
    throw new Error(`Grant failed: ${grantResponse.statusCode} ${grantResponse.body}`);
  }
  const grant = grantResponse.json<UploadGrantBody>();
  const form = buildUploadForm(grant, input.file, input.filename);
  const isOwnRoute = new URL(grant.upload.url).pathname.startsWith('/api/media/uploads/');
  const upload = isOwnRoute
    ? await injectForm(app, grant.upload.url, form).then((r) => ({ status: r.statusCode, body: r.body }))
    : await fetch(grant.upload.url, { method: 'POST', body: form }).then(async (r) => ({
        status: r.status,
        body: await r.text(),
      }));
  return { grant, upload, confirm: await confirmGrant(app, headers, grant.grantId) };
};

/** Uploads and expects success; returns the asset. */
export const uploadAsset = async (app: FastifyInstance, headers: Headers, input: UploadInput) => {
  const { upload, confirm } = await uploadThroughGrant(app, headers, input);
  if (upload.status >= 300 || confirm.statusCode !== 201) {
    throw new Error(`Upload failed: ${upload.status} ${upload.body} / ${confirm.statusCode} ${confirm.body}`);
  }
  return confirm.json<MediaAssetBody>();
};

const MAX_ROUNDS = 10;

/**
 * Runs media jobs to completion with the app's storage. Jobs that asked to be retried (e.g. a visibility
 * move waiting for processing) are made due again at once instead of waiting out their backoff. Throws if
 * any job died or still fails after a few rounds.
 */
export const runMediaJobs = async (app: FastifyInstance, db: Database) => {
  const worker = createWorker({
    db,
    handlers: createJobHandlers(createMediaJobHandlers({ db, storage: app.mediaStorage })),
    workerId: `test-${randomUUID()}`,
    concurrency: 4,
    pollIntervalMs: 50,
    leaseMs: 30_000,
    log: silentLogger,
  });
  const retrying = () =>
    db
      .updateTable('jobs')
      .set({ run_at: new Date() })
      .where('type', 'like', 'media.%')
      .where('type', '!=', 'media.grant.expire')
      .where('status', '=', 'pending')
      .where('attempts', '>', 0)
      .returning(['type', 'last_error'])
      .execute();
  for (let round = 0; ; round += 1) {
    while ((await worker.tick()) > 0) {
      await waitFor(async () => worker.runningJobIds.size === 0, { timeoutMs: 30_000 });
    }
    await waitFor(async () => worker.runningJobIds.size === 0, { timeoutMs: 30_000 });
    const pending = await retrying();
    if (pending.length === 0) {
      break;
    }
    if (round >= MAX_ROUNDS) {
      throw new Error(`Media jobs keep failing: ${JSON.stringify(pending)}`);
    }
  }
  const dead = await db
    .selectFrom('jobs')
    .select(['type', 'last_error'])
    .where('type', 'like', 'media.%')
    .where('status', '=', 'dead')
    .execute();
  if (dead.length > 0) {
    throw new Error(`Media jobs died: ${JSON.stringify(dead)}`);
  }
};

/** Path and query of an absolute URL, for `app.inject`. */
export const pathOf = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};
