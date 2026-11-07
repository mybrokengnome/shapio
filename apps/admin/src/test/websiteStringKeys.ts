/**
 * Translation keys whose "site" means an actual website, not the Shapio concept (which the admin calls a
 * workspace; plan workspace-rename). `workspaceWording.test.ts` allows "site" in these values and nowhere else.
 */
export const WEBSITE_STRING_KEYS: readonly string[] = [
  // SEO settings: the website's name, title template and X (Twitter) account (og:site_name, twitter:site).
  'seo.settings.siteName',
  'seo.settings.siteNameHint',
  'seo.settings.titleTemplatePlaceholder',
  'seo.settings.twitterHandleHint',
  // Preview: the website shown in the preview frame, and what it shows to visitors.
  'entry.preview.site',
  'entry.preview.noUrlDescription',
  'entry.preview.notFramableTitle',
  'entry.preview.blockedTitle',
  'entry.preview.blockedDescription',
  'entry.preview.sdkMissingTitle',
  'place.actions.previewUnavailable',
  'entry.preflight.rules.relationUnpublished',
  // Deployments: the host's site ID (Netlify), the deployed site's URL, and website builds.
  'publishing.deployments.settingLabels.siteId',
  'publishing.deployments.siteUrl',
  'roles.actions.deploymentsTrigger',
  // The websites and apps that read the API: "your site or build pipeline", "sites and apps".
  'inbox.getStarted.token.description',
  'home.createTokenDescription',
  'apiTokens.emptyDescription',
  'roles.kindHint',
  'roles.actions.readDraftsHint',
  'locales.defaultDescription',
  'models.plan.acknowledgeBreaking',
  'develop.api.request.snapshotHint',
  'develop.api.request.tokenHint',
];
