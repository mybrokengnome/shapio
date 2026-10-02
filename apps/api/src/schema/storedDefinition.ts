import { hashDefinition, withDerivedPlural, type SchemaDefinition } from '@shapio/schema';

/**
 * Reads a definition stored on a `schema_revisions` row. Revisions are immutable, so a collection saved
 * before plural API IDs existed has no `pluralApiKey`; it gets the value normalizing would fill
 * (`@shapio/schema` `withDerivedPlural`), so the snapshot, pull files and GraphQL agree before anyone saves.
 * Every read of a stored definition goes through here.
 */
export const readStoredDefinition = (stored: unknown): SchemaDefinition =>
  withDerivedPlural(stored as SchemaDefinition).definition;

export type StoredDefinition = { definition: SchemaDefinition; hash: string };

/**
 * A stored definition with a hash that matches it: the stored hash, or, when a plural API ID was filled,
 * the hash of the filled definition (the hash a pull of it records, so pull → apply shows no change).
 */
export const readStoredRevision = async (stored: unknown, hash: string): Promise<StoredDefinition> => {
  const { definition, filled } = withDerivedPlural(stored as SchemaDefinition);
  return { definition, hash: filled ? await hashDefinition(definition) : hash };
};
