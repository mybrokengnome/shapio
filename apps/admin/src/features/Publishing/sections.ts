import type { GlobalAction } from '@shapio/client';

export type PublishingPath = '/publishing/scheduled' | '/publishing/deployments' | '/publishing/webhooks';

type PublishingSection = {
  to: PublishingPath;
  labelKey: string;
  /** Hidden unless the admin holds this permission (the server enforces it either way). */
  permission?: GlobalAction;
};

export const PUBLISHING_SECTIONS = [
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
  // Everyone may follow deployments; managing connections needs `deployments.manage`.
  { to: '/publishing/deployments', labelKey: 'publishing.nav.deployments' },
] as const satisfies readonly PublishingSection[];

export const permittedSections = (permissions: readonly GlobalAction[]) =>
  PUBLISHING_SECTIONS.filter(
    (section: PublishingSection) => !section.permission || permissions.includes(section.permission),
  );

/** Where `/publishing` lands: the first tab the admin may open (Deployments is open to everyone). */
export const firstPermittedSection = (permissions: readonly GlobalAction[]): PublishingPath =>
  permittedSections(permissions)[0]?.to ?? '/publishing/deployments';
