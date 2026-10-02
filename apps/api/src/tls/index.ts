import type { Server as HttpsServer } from 'node:https';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { startCertificateReloader, type CertificateReloader } from './certificateReloader.js';
import { readCertificateFiles, type CertificatePair } from './certificates.js';
import { startHttpListener } from './httpListener.js';

export type TlsRuntime = {
  /** Certificate to start HTTPS with; undefined means plain HTTP. */
  initial: CertificatePair | undefined;
  /** Starts reloading changed certificate files once the HTTPS server exists (no restart needed). */
  start: (server: HttpsServer) => void;
  /** Port of the plain-HTTP redirect listener, if any. */
  httpPort: number | undefined;
  close: () => Promise<void>;
};

export class TlsSetupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TlsSetupError';
  }
}

const PLAIN_HTTP: TlsRuntime = {
  initial: undefined,
  start: () => {},
  httpPort: undefined,
  close: async () => {},
};

type PrepareTlsOptions = { config: AppConfig; urls: UrlBuilder; log: FastifyBaseLogger };

/**
 * Decides how Shapio terminates TLS itself (no reverse proxy needed): plain HTTP, or HTTPS from
 * TLS_CERT_FILE/TLS_KEY_FILE. With HTTPS it optionally starts the HTTP_PORT redirect listener, and
 * re-reads the certificate files so a renewal is picked up without a restart.
 */
export const prepareTls = async ({ config, urls, log }: PrepareTlsOptions): Promise<TlsRuntime> => {
  const { tls, server } = config;
  if (tls.mode === 'off') {
    return PLAIN_HTTP;
  }
  const initial = await readCertificateFiles(tls.certFile, tls.keyFile).catch((error: unknown) => {
    throw new TlsSetupError(
      `Could not load TLS_CERT_FILE (${tls.certFile}) and TLS_KEY_FILE (${tls.keyFile})`,
      { cause: error },
    );
  });
  const listener =
    server.httpPort === undefined
      ? undefined
      : await startHttpListener({ host: server.host, port: server.httpPort, urls, log });
  let reloader: CertificateReloader | undefined;
  return {
    initial,
    httpPort: listener?.port,
    start: (httpsServer) => {
      reloader = startCertificateReloader({
        certFile: tls.certFile,
        keyFile: tls.keyFile,
        initial,
        intervalMs: tls.reloadIntervalMs,
        apply: ({ key, cert }) => httpsServer.setSecureContext({ key, cert }),
        log: log.child({ component: 'tls' }),
      });
    },
    close: async () => {
      reloader?.stop();
      await listener?.close();
    },
  };
};
