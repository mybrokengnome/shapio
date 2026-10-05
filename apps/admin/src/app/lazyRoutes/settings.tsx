import { createLazyRoute } from '@tanstack/react-router';
import { Settings } from '@/features/Settings';
import { ApiTokens } from '@/features/Settings/ApiTokens';
import { Appearance } from '@/features/Settings/Appearance';
import { Assist } from '@/features/Settings/Assist';
import { Locales } from '@/features/Settings/Locales';
import { Profile } from '@/features/Settings/Profile';
import { Seo } from '@/features/Settings/Seo';
import { Sessions } from '@/features/Settings/Sessions';

/** Every settings screen, loaded together on the first visit to Settings. */
export const settingsLazyRoutes = {
  settings: createLazyRoute('/app/settings')({ component: Settings }),
  profile: createLazyRoute('/app/settings/profile')({ component: Profile }),
  sessions: createLazyRoute('/app/settings/sessions')({ component: Sessions }),
  theme: createLazyRoute('/app/settings/theme')({ component: Appearance }),
  locales: createLazyRoute('/app/settings/locales')({ component: Locales }),
  seo: createLazyRoute('/app/settings/seo')({ component: Seo }),
  assist: createLazyRoute('/app/settings/assist')({ component: Assist }),
  apiTokens: createLazyRoute('/app/settings/api-tokens')({ component: ApiTokens }),
};
