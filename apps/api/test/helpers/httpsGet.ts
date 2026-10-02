import { request } from 'node:https';
import type { PeerCertificate, TLSSocket } from 'node:tls';

export type HttpsResponse = { status: number; body: string; peerCertificate: PeerCertificate };

/** GET over HTTPS trusting `ca` (fetch cannot take a per-request CA). */
export const httpsGet = (url: string, ca: string | undefined): Promise<HttpsResponse> =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'GET', agent: false, ...(ca ? { ca } : { rejectUnauthorized: false }) },
      (res) => {
        // Read the certificate now: the socket is detached from the response once it ends.
        const peerCertificate = (res.socket as TLSSocket).getPeerCertificate();
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            peerCertificate,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
