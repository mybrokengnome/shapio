import { createLazyRoute } from '@tanstack/react-router';
import { Inbox } from '@/features/Inbox';

/** The Inbox (home), loaded on first visit with the schema helpers it labels entries with. */
export const inboxLazyRoute = createLazyRoute('/app/')({ component: Inbox });
