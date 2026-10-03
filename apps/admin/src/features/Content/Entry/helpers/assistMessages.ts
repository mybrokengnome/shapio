import type { SaveBeforeAssist } from '../hooks/useAssistTarget';

/** Why an entry assist didn't run: the changes have to be saved first, or saving them failed. */
export const SAVE_BEFORE_ASSIST_KEYS = {
  saveFirst: 'assist.saveFirst',
  failed: 'assist.saveFailed',
} as const satisfies Record<Exclude<SaveBeforeAssist, 'ready'>, string>;
