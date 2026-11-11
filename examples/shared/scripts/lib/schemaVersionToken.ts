/**
 * The schema version token in generated types (`npm run types`, scripts/types.ts), kept apart from the script
 * so it can be tested without running it.
 */

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
