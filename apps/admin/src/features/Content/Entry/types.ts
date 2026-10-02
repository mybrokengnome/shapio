import type { AdminEntry } from '@shapio/client';
import type { FormValues } from '@/fields/helpers/values';

/** What the document edits: a new entry, an existing locale version, or a locale the entry doesn't have yet. */
export type EntryMode =
  | { kind: 'create' }
  | { kind: 'edit'; entry: AdminEntry }
  | { kind: 'newLocale'; entryId: string; source: AdminEntry };

/** Reload the entry from the server and start the document again, optionally reapplying local values on top. */
export type ReloadEntry = (carry: FormValues | null) => void;
