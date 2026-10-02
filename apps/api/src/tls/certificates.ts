import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';

export type CertificatePair = { key: string; cert: string };

/**
 * Reads TLS_CERT_FILE / TLS_KEY_FILE and checks they form a usable pair (both parse and the key matches the
 * certificate), so a bad path or a half-written renewal fails here with context instead of at handshake time.
 */
export const readCertificateFiles = async (certFile: string, keyFile: string): Promise<CertificatePair> => {
  const [cert, key] = await Promise.all([readFile(certFile, 'utf8'), readFile(keyFile, 'utf8')]);
  createSecureContext({ cert, key });
  return { cert, key };
};
