import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index.js';

const PRODUCTION = { DATABASE_URL: 'postgres://localhost/shapio', PUBLIC_URL: 'https://cms.example.com' };
const DEVELOPMENT = { DATABASE_URL: 'postgres://localhost/shapio', NODE_ENV: 'development' };

const problemsOf = (env: Record<string, string>): readonly string[] => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  return [];
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(PRODUCTION);
    expect(config).toMatchObject({
      nodeEnv: 'production',
      server: {
        host: '127.0.0.1',
        port: 4300,
        httpPort: undefined,
        trustProxy: false,
        publicUrl: 'https://cms.example.com',
        basePath: '',
      },
      tls: { mode: 'off' },
      database: { url: PRODUCTION.DATABASE_URL, poolMax: 10, acquireTimeoutMs: 10_000, migrateOnStart: true },
      schema: { listen: true },
      worker: { mode: 'inline', concurrency: 4 },
      storage: { driver: 'local' },
      http: { corsOrigins: [] },
    });
  });

  it('turns the schema LISTEN client off with SCHEMA_LISTEN=false', () => {
    expect(loadConfig({ ...PRODUCTION, SCHEMA_LISTEN: 'false' }).schema).toEqual({ listen: false });
  });

  it('coerces types, parses lists and treats empty values as unset', () => {
    const config = loadConfig({
      ...PRODUCTION,
      PORT: '8080',
      TRUST_PROXY: '2',
      CORS_ORIGINS: 'https://a.test, https://b.test,',
      WORKER_MODE: 'dedicated',
      BASE_PATH: '/cms/',
    });
    expect(config.server).toMatchObject({ port: 8080, trustProxy: 2, basePath: '/cms' });
    expect(config.http.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(config.worker.mode).toBe('dedicated');
    expect(loadConfig({ ...PRODUCTION, TRUST_PROXY: 'true' }).server.trustProxy).toBe(true);
  });

  it('derives PUBLIC_URL from HOST and PORT outside production', () => {
    expect(loadConfig({ ...DEVELOPMENT, HOST: '0.0.0.0', PORT: '5000' }).server.publicUrl).toBe(
      'http://localhost:5000',
    );
  });

  it('configures HTTPS from files, with an optional redirect listener', () => {
    const config = loadConfig({
      ...PRODUCTION,
      TLS_CERT_FILE: 'c.pem',
      TLS_KEY_FILE: 'k.pem',
      HTTP_PORT: '8080',
    });
    expect(config.tls).toMatchObject({
      mode: 'files',
      certFile: expect.stringMatching(/c\.pem$/) as unknown,
      reloadIntervalMs: 60_000,
    });
    expect(config.server.httpPort).toBe(8080);
  });

  it('requires S3 settings only for the s3 driver', () => {
    expect(
      loadConfig({ ...PRODUCTION, STORAGE_DRIVER: 's3', STORAGE_S3_BUCKET: 'media' }).storage,
    ).toMatchObject({
      driver: 's3',
      s3: { bucket: 'media', forcePathStyle: false },
    });
  });

  it('keeps S3 settings with the local driver (for media migrate) and parses media limits', () => {
    expect(
      loadConfig({
        ...PRODUCTION,
        STORAGE_S3_BUCKET: 'media',
        MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/media/',
        MEDIA_ALLOWED_TYPES: 'image/*, Application/PDF',
        MEDIA_MAX_UPLOAD_BYTES: '1000',
      }).storage,
    ).toMatchObject({
      driver: 'local',
      s3: { bucket: 'media' },
      publicBaseUrl: 'https://cdn.example.com/media',
      allowedTypes: ['image/*', 'application/pdf'],
      maxUploadBytes: 1000,
    });
  });

  it.each([
    [{}, /DATABASE_URL/],
    [{ ...PRODUCTION, PORT: 'abc' }, /PORT/],
    [{ ...PRODUCTION, WORKER_MODE: 'cluster' }, /WORKER_MODE/],
    [{ ...PRODUCTION, PUBLIC_URL: 'ftp://x' }, /PUBLIC_URL/],
    [{ ...PRODUCTION, BASE_PATH: 'cms' }, /BASE_PATH/],
    [{ ...PRODUCTION, TRUST_PROXY: 'yes' }, /TRUST_PROXY/],
  ])('rejects invalid values %o', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  it.each([
    [{ DATABASE_URL: 'postgres://x' }, 'PUBLIC_URL is required in production'],
    [{ ...PRODUCTION, DATABASE_URL: 'notaurl' }, 'DATABASE_URL must be a postgres:// URL'],
    [{ ...PRODUCTION, DATABASE_URL: 'mongodb://localhost/shapio' }, 'DATABASE_URL must be a postgres:// URL'],
    [{ ...PRODUCTION, DATABASE_URL: 'mysql://localhost' }, 'DATABASE_URL must name the MySQL database'],
    [{ ...PRODUCTION, DATABASE_URL: 'sqlite:' }, 'or a sqlite: path'],
    [
      { ...PRODUCTION, DATABASE_URL: 'sqlite:./shapio.db', WORKER_MODE: 'dedicated' },
      'WORKER_MODE=dedicated needs PostgreSQL',
    ],
    [{ ...PRODUCTION, PUBLIC_URL: 'https://example.com/cms' }, 'put a sub-path in BASE_PATH'],
    [{ ...PRODUCTION, TLS_CERT_FILE: 'c.pem' }, 'must be set together'],
    [{ ...PRODUCTION, HTTP_PORT: '80' }, 'only used with HTTPS'],
    [{ ...PRODUCTION, TLS_CERT_FILE: 'c', TLS_KEY_FILE: 'k', HTTP_PORT: '443', PORT: '443' }, 'must differ'],
    [{ ...PRODUCTION, STORAGE_DRIVER: 's3' }, 'STORAGE_S3_BUCKET'],
    [{ ...PRODUCTION, MEDIA_ALLOWED_TYPES: 'image/*,exe' }, 'MEDIA_ALLOWED_TYPES has invalid entries: exe'],
  ])('rejects inconsistent settings %o', (env, message) => {
    expect(problemsOf(env).join('\n')).toContain(message);
  });

  it.each(['sqlite:./shapio.db', 'sqlite:/data/shapio.db', 'sqlite::memory:'])(
    'accepts the SQLite URL %s',
    (url) => {
      expect(problemsOf({ ...PRODUCTION, DATABASE_URL: url })).toEqual([]);
    },
  );

  it('accepts a MySQL URL that names the database, with WORKER_MODE=dedicated', () => {
    expect(
      problemsOf({
        ...PRODUCTION,
        DATABASE_URL: 'mysql://shapio:secret@db:3306/shapio',
        WORKER_MODE: 'dedicated',
      }),
    ).toEqual([]);
  });
});
