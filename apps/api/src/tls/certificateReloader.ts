import type { FastifyBaseLogger } from 'fastify';
import { readCertificateFiles, type CertificatePair } from './certificates.js';

type CertificateReloaderOptions = {
  certFile: string;
  keyFile: string;
  /** The pair the HTTPS server started with. */
  initial: CertificatePair;
  intervalMs: number;
  /** Swaps the pair into the running HTTPS server (`server.setSecureContext`). */
  apply: (pair: CertificatePair) => void;
  log: FastifyBaseLogger;
};

export type CertificateReloader = {
  /** Re-reads the files once and applies them if they changed; exposed for tests. */
  check: () => Promise<void>;
  stop: () => void;
};

/**
 * Picks up renewed certificate files without a restart: re-reads TLS_CERT_FILE/TLS_KEY_FILE every
 * `intervalMs` and applies them when they changed and form a valid pair. Polling (rather than fs.watch or
 * SIGHUP) follows symlink swaps such as certbot's `live/` directory, works the same in Docker and on every
 * platform, and leaves SIGHUP to mean shutdown. A pair that does not load yet (e.g. the certificate is
 * written but the key is not) is logged and retried; the previous certificate keeps serving meanwhile.
 */
export const startCertificateReloader = ({
  certFile,
  keyFile,
  initial,
  intervalMs,
  apply,
  log,
}: CertificateReloaderOptions): CertificateReloader => {
  let current = initial;
  let lastFailure: string | undefined;
  let checking = false;

  const check = async () => {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const next = await readCertificateFiles(certFile, keyFile);
      lastFailure = undefined;
      if (next.cert === current.cert && next.key === current.key) {
        return;
      }
      apply(next);
      current = next;
      log.info({ certFile }, 'TLS certificate files changed; new certificate applied without restart');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Log each distinct failure once, not on every tick, while the previous certificate keeps serving.
      if (message !== lastFailure) {
        lastFailure = message;
        log.warn(
          { err: error, certFile, keyFile },
          'TLS certificate files could not be reloaded; still serving the previous certificate, will retry',
        );
      }
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), intervalMs);
  timer.unref();
  return { check, stop: () => clearInterval(timer) };
};
