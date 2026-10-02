/**
 * Replaces secret-looking values in job payloads and results before they are shown in the admin. Shapio's
 * own jobs carry IDs rather than secrets; this is the safety net for anything that slips in (and for
 * extension jobs).
 */
const SECRET_KEY =
  /secret|token|password|passwd|authorization|signature|cookie|api[-_]?key|private[-_]?key|credential|hook[-_]?url/i;
const MAX_DEPTH = 8;

export const REDACTED = '[redacted]';

export const redactSecrets = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) && item !== null && item !== '' ? REDACTED : redactSecrets(item, depth + 1),
    ]),
  );
};

/** Header names whose values never appear in delivery logs. */
export const redactHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, SECRET_KEY.test(name) ? REDACTED : value]),
  );
