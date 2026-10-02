/** Metadata fields that name an audit event's target, in order of preference. */
const NAME_FIELDS = ['name', 'title', 'label', 'email', 'filename', 'apiKey'] as const;

/** The target's name as the server recorded it in the event's metadata, if it did. */
export const auditTargetName = (metadata: unknown): string | undefined => {
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }
  const record = metadata as Record<string, unknown>;
  for (const field of NAME_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
};
