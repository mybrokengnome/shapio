import { z } from 'zod';

export const CHANGE_SET_TABS = ['changes', 'checks', 'consumers', 'timeline'] as const;
export type ChangeSetTab = (typeof CHANGE_SET_TABS)[number];

/** `/changes/:id?tab=`: the review tab lives in the URL (bookmarkable, back-button friendly). */
export const changeSetSearchSchema = z.object({ tab: z.enum(CHANGE_SET_TABS).optional().catch(undefined) });
