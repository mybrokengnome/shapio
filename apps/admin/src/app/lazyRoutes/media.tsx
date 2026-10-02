import { createLazyRoute } from '@tanstack/react-router';
import { Media } from '@/features/Media';

/** The media library, loaded on first visit. */
export const mediaLazyRoute = createLazyRoute('/app/media')({ component: Media });
