import { createLazyRoute } from '@tanstack/react-router';
import { Settings } from '@/features/Settings';
import { ApiTokens } from '@/features/Settings/ApiTokens';
import { Appearance } from '@/features/Settings/Appearance';
import { Locales } from '@/features/Settings/Locales';
import { Profile } from '@/features/Settings/Profile';
import { Sessions } from '@/features/Settings/Sessions';

/** Every settings screen, loaded together on the first visit to Settings. */
export const settingsLazyRoutes = {
  settings: createLazyRoute('/app/settings')({ component: Settings }),
  profile: createLazyRoute('/app/settings/profile')({ component: Profile }),
  sessions: createLazyRoute('/app/settings/sessions')({ component: Sessions }),
  theme: createLazyRoute('/app/settings/theme')({ component: Appearance }),
  locales: createLazyRoute('/app/settings/locales')({ component: Locales }),
  apiTokens: createLazyRoute('/app/settings/api-tokens')({ component: ApiTokens }),
};
