import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { ShapioApiError } from '@shapio/client';
import type { CliIo } from '../../types.js';

/**
 * HTTP for `shapio export` and `shapio import`: the same base URL and admin API token as the other remote
 * commands (SHAPIO_URL / SHAPIO_TOKEN), plus streaming bodies, which the JSON client does not do. A 429 from
 * the instance's rate limit is waited out and retried.
 */
export const DEFAULT_URL = 'http://localhost:4300';
const MAX_RETRIES = 8;

export type Connection = { baseUrl: string; token: string };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export type TransferArgs = { connection: Connection; flags: Record<string, boolean>; file: string };

/** `[--url] [--token] [--<flag>...] <file>` for both commands. */
export const parseTransferArgs = (
  args: readonly string[],
  io: CliIo,
  flags: readonly string[],
): TransferArgs => {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
      ...Object.fromEntries(flags.map((flag) => [flag, { type: 'boolean' as const, default: false }])),
    },
    allowPositionals: true,
  });
  const token = values.token ?? io.env.SHAPIO_TOKEN;
  if (!token) {
    throw new UsageError('An admin API token is required: pass --token or set SHAPIO_TOKEN');
  }
  const [file, ...extra] = positionals;
  if (!file || extra.length > 0) {
    throw new UsageError('Give exactly one bundle file');
  }
  return {
    connection: { baseUrl: values.url ?? io.env.SHAPIO_URL ?? DEFAULT_URL, token },
    flags: Object.fromEntries(
      flags.map((flag) => [flag, (values as Record<string, unknown>)[flag] === true]),
    ),
    file,
  };
};

export type RequestInput = {
  method?: string;
  query?: Record<string, string | number | boolean>;
  /** A body factory (called again on a retry), streamed as-is. */
  body?: () => Readable;
  contentType?: string;
};

const errorFrom = async (response: Response) => {
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON: keep the text
  }
  return new ShapioApiError(response.status, parsed);
};

const retryAfterMs = (response: Response, attempt: number) => {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt;
};

/** A request whose non-2xx answers throw `ShapioApiError`; returns the response for streaming its body. */
export const send = async (
  connection: Connection,
  path: string,
  input: RequestInput = {},
): Promise<Response> => {
  const url = new URL(`${connection.baseUrl.replace(/\/+$/, '')}${path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  for (let attempt = 0; ; attempt += 1) {
    const body = input.body?.();
    const response = await fetch(url, {
      method: input.method ?? 'GET',
      headers: {
        authorization: `Bearer ${connection.token}`,
        ...(input.contentType ? { 'content-type': input.contentType } : {}),
      },
      ...(body ? { body: Readable.toWeb(body) as ReadableStream, duplex: 'half' } : {}),
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      await response.body?.cancel();
      await delay(retryAfterMs(response, attempt));
      continue;
    }
    if (!response.ok) {
      throw await errorFrom(response);
    }
    return response;
  }
};

export const sendJson = async <T>(connection: Connection, path: string, input: RequestInput = {}) =>
  (await (await send(connection, path, input)).json()) as T;

/** The response body as a Node stream. */
export const bodyOf = (response: Response): Readable => {
  if (!response.body) {
    throw new Error('The response has no body');
  }
  // Typed through `unknown`: Node's and the DOM's ReadableStream types differ (this file is also compiled
  // with the DOM library, by the example site).
  const body: unknown = response.body;
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
};

export const describeFailure = (error: unknown) =>
  error instanceof ShapioApiError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
