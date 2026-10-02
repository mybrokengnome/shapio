import type { HealthRule } from '@shapio/client';
import {
  Clock,
  Copy,
  FilePen,
  FileWarning,
  ImageOff,
  Languages,
  Link2Off,
  Unlink,
  type LucideIcon,
} from 'lucide-react';

/** Findings fetched per page; groups show the first few until "Show all". */
export const FINDINGS_PAGE_SIZE = 100;
export const GROUP_PREVIEW = 5;
/** Schedules read to find the soonest (the API lists newest first), and how many are shown. */
export const SCHEDULES_SCANNED = 50;
export const SCHEDULED_SHOWN = 5;
/** "Recently published" diffs this many snapshots back from the live one, and shows this many entries. */
export const RECENT_SNAPSHOTS = 5;
export const RECENT_SHOWN = 6;

/** The order groups appear in: what blocks publishing or readers first, housekeeping last. */
export const RULE_ORDER: readonly HealthRule[] = [
  'requiredEmpty',
  'relationMissing',
  'uniqueConflict',
  'altMissing',
  'relationUnpublished',
  'localeMissing',
  'unpublishedChanges',
  'staleDraft',
];

export const RULE_ICONS = {
  requiredEmpty: FileWarning,
  altMissing: ImageOff,
  localeMissing: Languages,
  relationMissing: Unlink,
  relationUnpublished: Link2Off,
  uniqueConflict: Copy,
  staleDraft: Clock,
  unpublishedChanges: FilePen,
} as const satisfies Record<HealthRule, LucideIcon>;

export const RULE_TITLE_KEYS = {
  requiredEmpty: 'inbox.rules.requiredEmpty.title',
  altMissing: 'inbox.rules.altMissing.title',
  localeMissing: 'inbox.rules.localeMissing.title',
  relationMissing: 'inbox.rules.relationMissing.title',
  relationUnpublished: 'inbox.rules.relationUnpublished.title',
  uniqueConflict: 'inbox.rules.uniqueConflict.title',
  staleDraft: 'inbox.rules.staleDraft.title',
  unpublishedChanges: 'inbox.rules.unpublishedChanges.title',
} as const satisfies Record<HealthRule, string>;

export const RULE_SENTENCE_KEYS = {
  requiredEmpty: 'inbox.rules.requiredEmpty.sentence',
  altMissing: 'inbox.rules.altMissing.sentence',
  localeMissing: 'inbox.rules.localeMissing.sentence',
  relationMissing: 'inbox.rules.relationMissing.sentence',
  relationUnpublished: 'inbox.rules.relationUnpublished.sentence',
  uniqueConflict: 'inbox.rules.uniqueConflict.sentence',
  staleDraft: 'inbox.rules.staleDraft.sentence',
  unpublishedChanges: 'inbox.rules.unpublishedChanges.sentence',
} as const satisfies Record<HealthRule, string>;

export const RULE_FIX_KEYS = {
  requiredEmpty: 'inbox.rules.requiredEmpty.fix',
  altMissing: 'inbox.rules.altMissing.fix',
  localeMissing: 'inbox.rules.localeMissing.fix',
  relationMissing: 'inbox.rules.relationMissing.fix',
  relationUnpublished: 'inbox.rules.relationUnpublished.fix',
  uniqueConflict: 'inbox.rules.uniqueConflict.fix',
  staleDraft: 'inbox.rules.staleDraft.fix',
  unpublishedChanges: 'inbox.rules.unpublishedChanges.fix',
} as const satisfies Record<HealthRule, string>;
