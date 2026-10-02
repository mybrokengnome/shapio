import { publishingProblems } from './publishing.js';
import type { RawConfig } from './schema.js';

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const DATABASE_URL_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

const databaseUrlProblems = (raw: RawConfig): string[] => {
  const url = parseUrl(raw.DATABASE_URL);
  return url && DATABASE_URL_PROTOCOLS.has(url.protocol)
    ? []
    : ['DATABASE_URL must be a postgres:// URL, e.g. postgres://user:password@localhost:5432/shapio'];
};

const publicUrlProblems = (raw: RawConfig): string[] => {
  if (!raw.PUBLIC_URL) {
    return raw.NODE_ENV === 'production'
      ? [
          'PUBLIC_URL is required in production: the origin users reach Shapio at, e.g. https://cms.example.com',
        ]
      : [];
  }
  const url = parseUrl(raw.PUBLIC_URL);
  if (!url) {
    return ['PUBLIC_URL is not a valid URL'];
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '') {
    return ['PUBLIC_URL must be an origin only (scheme, host, optional port); put a sub-path in BASE_PATH'];
  }
  return [];
};

const tlsProblems = (raw: RawConfig): string[] => {
  const problems: string[] = [];
  const hasCert = raw.TLS_CERT_FILE !== undefined;
  const hasKey = raw.TLS_KEY_FILE !== undefined;
  if (hasCert !== hasKey) {
    problems.push('TLS_CERT_FILE and TLS_KEY_FILE must be set together');
  }
  if (raw.HTTP_PORT !== undefined && !(hasCert && hasKey)) {
    problems.push('HTTP_PORT is only used with HTTPS (TLS_CERT_FILE/TLS_KEY_FILE)');
  }
  if (raw.HTTP_PORT !== undefined && raw.HTTP_PORT !== 0 && raw.HTTP_PORT === raw.PORT) {
    problems.push('HTTP_PORT and PORT must differ');
  }
  return problems;
};

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/;

const storageProblems = (raw: RawConfig): string[] => {
  const problems: string[] = [];
  if (raw.STORAGE_DRIVER === 's3' && !raw.STORAGE_S3_BUCKET) {
    problems.push('STORAGE_DRIVER=s3 requires STORAGE_S3_BUCKET');
  }
  const invalidTypes = raw.MEDIA_ALLOWED_TYPES.split(',')
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type !== '' && !MIME_PATTERN.test(type));
  if (invalidTypes.length > 0) {
    problems.push(
      `MEDIA_ALLOWED_TYPES has invalid entries: ${invalidTypes.join(', ')} (use e.g. image/*,application/pdf)`,
    );
  }
  const base = raw.MEDIA_PUBLIC_BASE_URL ? parseUrl(raw.MEDIA_PUBLIC_BASE_URL) : undefined;
  if (raw.MEDIA_PUBLIC_BASE_URL && (!base || base.search !== '' || base.hash !== '')) {
    problems.push('MEDIA_PUBLIC_BASE_URL must be a URL without a query or fragment');
  }
  return problems;
};

const emailProblems = (raw: RawConfig): string[] =>
  raw.EMAIL_TRANSPORT === 'smtp' && !raw.SMTP_HOST ? ['EMAIL_TRANSPORT=smtp requires SMTP_HOST'] : [];

const linkUrlProblem = (name: string, value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }
  const url = parseUrl(value);
  return !url || url.hash !== ''
    ? [`${name} must be a URL without a fragment (Shapio appends #token=…)`]
    : [];
};

/** Schemes a return URL may never use, whatever the configuration says. */
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

/** Each APP_AUTH_RETURN_URLS entry: an http(s) origin, or a custom-scheme prefix such as `myapp://auth`. */
const returnUrlProblems = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .flatMap((entry) => {
      const url = parseUrl(entry);
      if (!url || UNSAFE_SCHEMES.has(url.protocol) || !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(entry)) {
        return [
          `APP_AUTH_RETURN_URLS: "${entry}" is not an origin or a custom-scheme prefix like myapp://auth`,
        ];
      }
      const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
      if (isWeb && (url.origin !== entry.replace(/\/$/, '') || url.username !== '')) {
        return [`APP_AUTH_RETURN_URLS: "${entry}" must be an origin only (scheme, host, optional port)`];
      }
      return [];
    });

const appAuthProblems = (raw: RawConfig): string[] => {
  const problems = [
    ...returnUrlProblems(raw.APP_AUTH_RETURN_URLS),
    ...linkUrlProblem('APP_AUTH_CONFIRM_EMAIL_URL', raw.APP_AUTH_CONFIRM_EMAIL_URL),
    ...linkUrlProblem('APP_AUTH_RESET_PASSWORD_URL', raw.APP_AUTH_RESET_PASSWORD_URL),
  ];
  if (raw.APP_AUTH_REQUIRE_EMAIL_CONFIRMATION && !raw.APP_AUTH_CONFIRM_EMAIL_URL) {
    problems.push(
      'APP_AUTH_REQUIRE_EMAIL_CONFIRMATION=true requires APP_AUTH_CONFIRM_EMAIL_URL (the page on your site that confirms the address)',
    );
  }
  for (const provider of ['GOOGLE', 'GITHUB'] as const) {
    const id = raw[`APP_AUTH_${provider}_CLIENT_ID`];
    const secret = raw[`APP_AUTH_${provider}_CLIENT_SECRET`];
    if ((id === undefined) !== (secret === undefined)) {
      problems.push(
        `APP_AUTH_${provider}_CLIENT_ID and APP_AUTH_${provider}_CLIENT_SECRET must be set together`,
      );
    }
  }
  return problems;
};

/** Rules that span several settings. Each problem is a sentence an operator can act on. */
export const findConfigProblems = (raw: RawConfig): string[] => [
  ...databaseUrlProblems(raw),
  ...publicUrlProblems(raw),
  ...tlsProblems(raw),
  ...storageProblems(raw),
  ...emailProblems(raw),
  ...appAuthProblems(raw),
  ...publishingProblems(raw),
];
