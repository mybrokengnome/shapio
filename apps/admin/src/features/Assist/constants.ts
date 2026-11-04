import type { AcceptContentOpsResult } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

type NotAdded = Extract<AcceptContentOpsResult['changeSet'], { added: false }>['reason'];

/** Why an accepted fill was saved as a draft only, outside the run's change set. */
export const NOT_ADDED_KEYS = {
  unpublishedChanges: 'assist.fill.notAdded.unpublishedChanges',
  neverPublished: 'assist.fill.notAdded.neverPublished',
} as const satisfies Record<NotAdded, string>;

/** Why a fill run left an entry's field alone (`ContentOpsSkip.reason`); error codes are described apart. */
export const SKIP_REASON_KEYS = {
  fieldNotSuggestible: 'assist.fill.skip.fieldNotSuggestible',
  notReadable: 'assist.fill.skip.notReadable',
  notEditable: 'assist.fill.skip.notEditable',
  publishesOnSave: 'assist.fill.skip.publishesOnSave',
  filledMeanwhile: 'assist.fill.skip.filledMeanwhile',
  modelMissing: 'assist.fill.skip.modelMissing',
  otherRequiredEmpty: 'assist.fill.skip.otherRequiredEmpty',
  unsavedWork: 'assist.fill.skip.unsavedWork',
} as const;

export const isKnownSkipReason = (reason: string): reason is keyof typeof SKIP_REASON_KEYS =>
  Object.hasOwn(SKIP_REASON_KEYS, reason);

export const FILL_OUTCOME_TONES = {
  added: 'success',
  draftOnly: 'muted',
  filledMeanwhile: 'warning',
  unsavedWork: 'warning',
  invalid: 'danger',
  rejected: 'muted',
} as const satisfies Record<string, StatusTone>;
