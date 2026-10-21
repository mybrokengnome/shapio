import type { GlobalAction } from '@shapio/client';

export type PublishingPath = '/publishing/scheduled' | '/publishing/deployments' | '/publishing/webhooks';

type PublishingSection = {
  to: PublishingPath;
  labelKey: string;
  /** Hidden unless the admin holds this permission (the server enforces it either way). */
  permission?: GlobalAction;
};

/**
 * The tabs of the Deployments area (its URLs keep the older `/publishing` name, so links and bookmarks still
 * work): connections and runs first, then scheduled publications and webhooks.
 */
export const PUBLISHING_SECTIONS = [
  // Everyone may follow deployments; managing connections needs `deployments.manage`.
  { to: '/publishing/deployments', labelKey: 'publishing.nav.deployments' },
  {
    to: '/publishing/scheduled',
    labelKey: 'publishing.nav.scheduled',
    permission: 'publishing.manage',
  },
  {
    to: '/publishing/webhooks',
    labelKey: 'publishing.nav.webhooks',
    permission: 'webhooks.manage',
  },
] as const satisfies readonly PublishingSection[];

export const permittedSections = (permissions: readonly GlobalAction[]) =>
  PUBLISHING_SECTIONS.filter(
    (section: PublishingSection) => !section.permission || permissions.includes(section.permission),
  );

/** Where `/publishing` lands: the first tab the admin may open, Deployments' connections (open to everyone). */
export const firstPermittedSection = (permissions: readonly GlobalAction[]): PublishingPath =>
  permittedSections(permissions)[0]?.to ?? '/publishing/deployments';
