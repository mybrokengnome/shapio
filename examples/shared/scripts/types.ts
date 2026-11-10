import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ShapioApiError } from '@shapio/client';
import { connectAdmin } from './lib/admin.js';

/**
 * `npm run types`: what `shapio types generate` does, without installing the Shapio CLI. Fetches the
 * TypeScript types of the instance's current schema (`/api/docs/typescript`, admin access: SHAPIO_TOKEN, or
 * SHAPIO_ADMIN_EMAIL + SHAPIO_ADMIN_PASSWORD as for the seed) and writes them, as the server renders them, to
 * src/lib/shapio.generated.ts. It then rewrites src/lib/schemaVersion.ts with the types' `SCHEMA_VERSION`,
 * the schema version the site's Shapio client names: a built site keeps reading content in that shape when
 * the schema moves on, and moves forward when this runs again. Nothing else is changed (not .env).
 */
const GENERATED_PATH = 'src/lib/shapio.generated.ts';
const SCHEMA_VERSION_PATH = 'src/lib/schemaVersion.ts';

type TypesResponse = { schemaVersion: number; source: string };

/** `<schemaId>:<version>`, exactly as Shapio issues it: nothing else is ever written into source. */
const SCHEMA_VERSION_TOKEN = /^[0-9A-Za-z-]+:\d{1,10}$/;

/**
 * The `SCHEMA_VERSION` token the server writes into the types (Shapio 0.9.0 or later); undefined when there is
 * none, or when it is not the strict `<schemaId>:<version>` shape (warned about, and treated as none).
 */
export const schemaVersionTokenOf = (
  source: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): string | undefined => {
  const token = /^export const SCHEMA_VERSION = '(.*)'/m.exec(source)?.[1];
  if (token === undefined || SCHEMA_VERSION_TOKEN.test(token)) {
    return token;
  }
  warn(
    `Ignoring the SCHEMA_VERSION in the generated types: ${JSON.stringify(token)} is not <schemaId>:<version>. The site reads today's schema.`,
  );
  return undefined;
};

/** src/lib/schemaVersion.ts naming `token`, or undefined (today's schema). */
const schemaVersionModule = (token: string | undefined) => `/**
 * The schema version this site was built against, passed to the Shapio client as \`schemaVersion\`.
 * \`npm run types\` rewrites this file from the SCHEMA_VERSION in src/lib/shapio.generated.ts; undefined
 * (before the first run, or against Shapio before 0.9.0) reads today's schema.
 */
export const SCHEMA_VERSION: string | undefined = ${token === undefined ? 'undefined' : `'${token}'`};
`;

const write = async (path: string, content: string) => {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
};

const main = async () => {
  const admin = await connectAdmin(process.env);
  try {
    const { schemaVersion, source } = await admin.client.request<TypesResponse>('/api/docs/typescript');
    const token = schemaVersionTokenOf(source);
    await write(GENERATED_PATH, source);
    await write(SCHEMA_VERSION_PATH, schemaVersionModule(token));
    process.stdout.write(
      token === undefined
        ? `Wrote types for schema version ${schemaVersion} to ${GENERATED_PATH}. The server sent no SCHEMA_VERSION (Shapio before 0.9.0): the site reads today's schema.`
        : `Wrote types for schema version ${schemaVersion} to ${GENERATED_PATH}, and SCHEMA_VERSION ${token} to ${SCHEMA_VERSION_PATH}.`,
    );
    process.stdout.write('\n');
  } finally {
    await admin.close();
  }
};

const describeFailure = (error: unknown): string =>
  error instanceof ShapioApiError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

// Run as a script (`npm run types`); importing it (the test) only takes the helpers.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`types failed: ${describeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
