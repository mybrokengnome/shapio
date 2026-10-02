import { X509Certificate } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/freePort.js';
import { httpsGet } from './helpers/httpsGet.js';
import { createSelfSignedCertificate } from './helpers/selfSignedCertificate.js';
import { spawnServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const fingerprintOf = (certPem: string) => new X509Certificate(certPem).fingerprint256;

describe('listening: custom PORT/HOST and built-in HTTPS (child processes)', () => {
  const database = useTestDatabase();
  const certificate = createSelfSignedCertificate();
  const renewed = createSelfSignedCertificate();
  afterAll(() => {
    certificate.cleanup();
    renewed.cleanup();
  });

  it('listens on the configured HOST and PORT', async () => {
    const port = await freePort();
    const server = await spawnServer({
      DATABASE_URL: database.current.url,
      HOST: '127.0.0.1',
      PORT: String(port),
    });
    try {
      expect(server.url).toBe(`http://127.0.0.1:${port}`);
      expect((await fetch(`http://127.0.0.1:${port}/api/ready`)).status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('serves HTTPS from TLS_CERT_FILE/TLS_KEY_FILE and redirects plain HTTP to PUBLIC_URL', async () => {
    const [port, httpPort] = await Promise.all([freePort(), freePort()]);
    const server = await spawnServer({
      DATABASE_URL: database.current.url,
      PORT: String(port),
      HTTP_PORT: String(httpPort),
      PUBLIC_URL: `https://localhost:${port}`,
      BASE_PATH: '/cms',
      TLS_CERT_FILE: certificate.certFile,
      TLS_KEY_FILE: certificate.keyFile,
    });
    try {
      expect(server.url).toBe(`https://127.0.0.1:${port}`);
      const ready = await httpsGet(`https://127.0.0.1:${port}/cms/api/ready`, certificate.cert);
      expect(ready.status).toBe(200);
      expect(ready.body).toContain('"ready"');

      const redirect = await fetch(`http://127.0.0.1:${httpPort}/cms/admin/?tab=1`, { redirect: 'manual' });
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get('location')).toBe(`https://localhost:${port}/cms/admin/?tab=1`);
    } finally {
      await server.stop();
    }
  });

  it('applies renewed certificate files without a restart, and ignores a half-written pair', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shapio-tls-reload-'));
    const certFile = join(directory, 'fullchain.pem');
    const keyFile = join(directory, 'privkey.pem');
    copyFileSync(certificate.certFile, certFile);
    copyFileSync(certificate.keyFile, keyFile);
    const port = await freePort();
    const server = await spawnServer({
      DATABASE_URL: database.current.url,
      PORT: String(port),
      PUBLIC_URL: `https://localhost:${port}`,
      TLS_CERT_FILE: certFile,
      TLS_KEY_FILE: keyFile,
      TLS_RELOAD_INTERVAL_MS: '1000',
    });
    const servedFingerprint = async () =>
      (await httpsGet(`https://127.0.0.1:${port}/api/ready`, undefined)).peerCertificate.fingerprint256;
    try {
      expect(await servedFingerprint()).toBe(fingerprintOf(certificate.cert));

      // A renewal caught half-way (new certificate, old key) is rejected; the old pair keeps serving.
      copyFileSync(renewed.certFile, certFile);
      await server.waitForLog(
        (line) => line.msg?.startsWith('TLS certificate files could not be reloaded') === true,
      );
      expect(await servedFingerprint()).toBe(fingerprintOf(certificate.cert));

      copyFileSync(renewed.keyFile, keyFile);
      await waitFor(async () => (await servedFingerprint()) === fingerprintOf(renewed.cert));
      expect(server.logs.some((line) => line.msg?.startsWith('TLS certificate files changed'))).toBe(true);
    } finally {
      await server.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails fast when the certificate files are missing', async () => {
    const startup = spawnServer({
      DATABASE_URL: database.current.url,
      TLS_CERT_FILE: '/nonexistent/cert.pem',
      TLS_KEY_FILE: '/nonexistent/key.pem',
    });
    await expect(startup).rejects.toThrow(/exited with code 1/);
  });
});
