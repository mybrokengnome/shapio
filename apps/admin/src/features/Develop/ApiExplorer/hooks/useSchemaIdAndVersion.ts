import { useCurrentSnapshot } from '@/api/snapshots';

/** `<schemaId>:<version>`: the schema ID may contain no colon, the version is the part after the last one. */
const TOKEN_PATTERN = /^(.+):(\d+)$/;

/**
 * The instance's schema ID and current schema version (plan schema-lenses), from the current snapshot's
 * `schemaVersionToken`; both undefined until it loads, or against a server that does not report one.
 */
export const useSchemaIdAndVersion = () => {
  const token = useCurrentSnapshot().data?.schemaVersionToken;
  const match = token ? TOKEN_PATTERN.exec(token) : null;
  return {
    schemaId: match?.[1],
    currentVersion: match ? Number(match[2]) : undefined,
  };
};
