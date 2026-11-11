import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ShapioApiError } from '@shapio/client';
import { connectAdmin } from './lib/admin.js';
import { schemaVersionTokenOf } from './lib/schemaVersionToken.js';

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

main().catch((error: unknown) => {
  process.stderr.write(`types failed: ${describeFailure(error)}\n`);
  process.exitCode = 1;
});
