import { useSchemaSettings } from '@/api/schema';

/**
 * The opt-in read-only lock (ADR 0002). While it is on, the server refuses model changes from the admin
 * (423 SCHEMA_READ_ONLY), so the builder disables editing and says why.
 */
export const useSchemaLock = () => {
  const settings = useSchemaSettings();
  return {
    locked: settings.data?.readOnly ?? false,
    reason: settings.data?.readOnlyReason ?? null,
  };
};
