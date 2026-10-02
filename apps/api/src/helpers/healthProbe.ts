import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PROBE_TIMEOUT_MS = 4000;

/**
 * Status code of a GET to `url`, or 0 on connection error/timeout. Certificate checks are skipped because
 * the probe targets 127.0.0.1, which a public certificate never names.
 */
export const probeStatus = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const request = url.startsWith('https:') ? httpsRequest : httpRequest;
    const req = request(
      url,
      { method: 'GET', timeout: PROBE_TIMEOUT_MS, rejectUnauthorized: false },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end();
  });
