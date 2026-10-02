import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { parseDestination, resolveDestination, type OutboundPolicy } from './ssrf.js';

/**
 * The only way publishing code sends HTTP to an admin-configured destination: SSRF-checked, pinned to the
 * checked address (the TLS certificate is still verified against the host name), no redirects followed,
 * bounded time and response size.
 */
export type OutboundRequest = {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  policy: OutboundPolicy;
  timeoutMs: number;
  /** Response bytes kept; the rest is read and dropped. */
  maxResponseBytes?: number;
  signal?: AbortSignal;
};

export type OutboundResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  truncated: boolean;
  durationMs: number;
};

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

export const sendOutbound = async (input: OutboundRequest): Promise<OutboundResponse> => {
  const url = parseDestination(input.url);
  const pinned = await resolveDestination(url, input.policy);
  // Every lookup the socket makes returns the address that passed the check.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        [pinned],
      );
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
  const limit = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const started = Date.now();
  const options: RequestOptions = {
    method: input.method,
    headers: {
      'user-agent': 'Shapio',
      ...(input.body !== undefined ? { 'content-length': String(Buffer.byteLength(input.body)) } : {}),
      ...input.headers,
    },
    lookup,
    timeout: input.timeoutMs,
    agent: false,
    ...(input.signal ? { signal: input.signal } : {}),
  };
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<OutboundResponse>((resolve, reject) => {
    const deadline = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${input.timeoutMs} ms`));
    }, input.timeoutMs);
    const req = send(url, options, (res) => {
      const chunks: Buffer[] = [];
      let kept = 0;
      let truncated = false;
      res.on('data', (chunk: Buffer) => {
        if (kept < limit) {
          const slice = chunk.subarray(0, limit - kept);
          chunks.push(slice);
          kept += slice.length;
          truncated ||= slice.length < chunk.length;
        } else {
          truncated = true;
        }
      });
      res.on('end', () => {
        clearTimeout(deadline);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          truncated,
          durationMs: Date.now() - started,
        });
      });
      res.on('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${input.timeoutMs} ms`)));
    req.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    req.end(input.body);
  });
};

/** A response is a success only when 2xx; redirects are reported as failures because they are not followed. */
export const isSuccessStatus = (status: number) => status >= 200 && status < 300;

export const describeStatus = (status: number) =>
  status >= 300 && status < 400 ? `HTTP ${status} (redirects are not followed)` : `HTTP ${status}`;
