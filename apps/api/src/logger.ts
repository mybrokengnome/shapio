import { pino, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from './config/index.js';
import { redactUrlSecrets } from './helpers/redactUrl.js';

/**
 * Paths never written to logs. Session cookies, tokens and passwords must not reach log shipping
 * (brief §8). Packages add their own paths here rather than redacting by hand.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.setupToken',
  // Admin identity (package B): hashes and session-bound secrets are as sensitive as the values.
  '*.csrfToken',
  '*.csrfSecret',
  '*.csrf_secret',
  '*.passwordHash',
  '*.password_hash',
  '*.tokenHash',
  '*.token_hash',
  '*.smtpPassword',
  // App users (package I): OAuth client secrets, PKCE verifiers, the state cookie and login-code hashes.
  '*.clientSecret',
  '*.codeVerifier',
  '*.stateCookie',
  '*.code_hash',
];

type LoggedRequest = {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  headers?: Record<string, unknown>;
  socket?: { remotePort?: number };
};

/**
 * Fastify's request serializer, except the URL's credential-bearing query values (signed media URLs, OAuth
 * callbacks) are redacted: `redact` paths cannot reach inside a URL string.
 */
export const LOG_SERIALIZERS = {
  req: (request: LoggedRequest) => ({
    method: request.method,
    url: redactUrlSecrets(request.url),
    version: request.headers?.['accept-version'],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }),
};

export const createLoggerOptions = (config: AppConfig): LoggerOptions => ({
  level: config.log.level,
  base: { instance: config.instanceId },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  serializers: LOG_SERIALIZERS,
  ...(config.log.pretty
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
    : {}),
});

export const createLogger = (config: AppConfig): Logger => pino(createLoggerOptions(config));
