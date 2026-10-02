import { SCHEDULE_STATUSES } from '@shapio/client';
import { z } from 'zod';
import { AUDIT_ACTOR_TYPES } from '@/constants/audit';
import { CONTENT_FILTER_OPERATORS, CONTENT_PAGE_SIZES } from '@/features/Content/constants';
import { ENTRY_STATUSES, PLACE_TABS } from '@/features/Content/Place/constants';
import { MEDIA_TYPE_FILTERS, MEDIA_VIEWS, ROOT_FOLDER } from '@/features/Media/constants';
import { MODEL_TABS, NEW_DEFINITION_KINDS } from '@/features/Models/constants';

export const AUDIT_PAGE_SIZE = 50;

export const loginSearchSchema = z.object({ redirect: z.string().optional().catch(undefined) });

export const auditSearchSchema = z.object({
  cursor: z.string().max(500).optional().catch(undefined),
  action: z.string().trim().min(1).max(200).optional().catch(undefined),
  actorType: z.enum(AUDIT_ACTOR_TYPES).optional().catch(undefined),
});

export type AuditSearch = z.infer<typeof auditSearchSchema>;

export const appUsersSearchSchema = z.object({
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
});

export type AppUsersSearch = z.infer<typeof appUsersSearchSchema>;

export const modelsSearchSchema = z.object({ tab: z.enum(MODEL_TABS).optional().catch(undefined) });

export const newModelSearchSchema = z.object({
  kind: z.enum(NEW_DEFINITION_KINDS).optional().catch(undefined),
});

export const mediaSearchSchema = z.object({
  /** A folder ID, `root` (no folder), or every folder when absent. */
  folder: z
    .union([z.literal(ROOT_FOLDER), z.uuid()])
    .optional()
    .catch(undefined),
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  type: z.enum(MEDIA_TYPE_FILTERS).optional().catch(undefined),
  view: z.enum(MEDIA_VIEWS).optional().catch(undefined),
  /** The asset whose details are open. */
  asset: z.uuid().optional().catch(undefined),
});

export type MediaSearch = z.infer<typeof mediaSearchSchema>;

/** A page of a cursor-paginated publishing list (runs, deliveries). */
const cursorParam = z.string().max(500).optional().catch(undefined);

export const cursorSearchSchema = z.object({ cursor: cursorParam });

export const schedulesSearchSchema = z.object({
  cursor: cursorParam,
  status: z.enum(SCHEDULE_STATUSES).optional().catch(undefined),
});

export type SchedulesSearch = z.infer<typeof schedulesSearchSchema>;

/** A content list's filter row: field API key (or createdAt/updatedAt), operator and text value. */
const contentFilterSchema = z.object({
  field: z
    .string()
    .regex(/^[_A-Za-z][_0-9A-Za-z]*$/)
    .max(64),
  operator: z.enum(CONTENT_FILTER_OPERATORS),
  value: z.string().max(1000).optional(),
});

export const contentListSearchSchema = z.object({
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1_000_000).optional().catch(undefined),
  pageSize: z.coerce
    .number()
    .refine((size) => (CONTENT_PAGE_SIZES as readonly number[]).includes(size))
    .optional()
    .catch(undefined),
  /** `field:asc` or `field:desc`. */
  sort: z
    .string()
    .regex(/^[_A-Za-z][_0-9A-Za-z]*:(asc|desc)$/)
    .optional()
    .catch(undefined),
  locale: z.string().max(35).optional().catch(undefined),
  filters: z.array(contentFilterSchema).max(20).optional().catch(undefined),
  /** Only entries in this state (in the list's locale). */
  status: z.enum(ENTRY_STATUSES).optional().catch(undefined),
  /** Only entries created by this admin (user ID). */
  author: z.uuid().optional().catch(undefined),
  /** The place's tab (Structure and API need the schema permission; Entries when absent). */
  tab: z.enum(PLACE_TABS).optional().catch(undefined),
});

export type ContentListSearch = z.infer<typeof contentListSearchSchema>;

/** The content locale an entry is edited in (the default locale when absent). */
export const entrySearchSchema = z.object({
  locale: z.string().max(35).optional().catch(undefined),
  /** Opens the document's history at this revision (Snapshots → Timeline, "Open this version"). */
  revision: z.uuid().optional().catch(undefined),
});
