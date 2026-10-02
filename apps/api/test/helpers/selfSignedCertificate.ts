import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SelfSignedCertificate = { certFile: string; keyFile: string; cert: string; cleanup: () => void };

/** Generates a throwaway certificate for 127.0.0.1/localhost with the openssl CLI. */
export const createSelfSignedCertificate = (): SelfSignedCertificate => {
  const directory = mkdtempSync(join(tmpdir(), 'shapio-tls-'));
  const certFile = join(directory, 'cert.pem');
  const keyFile = join(directory, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      keyFile,
      '-out',
      certFile,
    ],
    { stdio: 'ignore' },
  );
  return {
    certFile,
    keyFile,
    cert: readFileSync(certFile, 'utf8'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
};
