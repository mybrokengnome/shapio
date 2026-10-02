import type { DeploymentProvider, DeploymentTriggerPolicy, PublicationAction } from '@shapio/client';

export const PUBLICATION_ACTION_LABELS = {
  publish: 'publishing.actions.publish',
  unpublish: 'publishing.actions.unpublish',
} as const satisfies Record<PublicationAction, string>;

export const PROVIDER_LABELS = {
  generic_webhook: 'publishing.deployments.providers.generic_webhook',
  cloudflare_pages: 'publishing.deployments.providers.cloudflare_pages',
  github: 'publishing.deployments.providers.github',
} as const satisfies Record<DeploymentProvider, string>;

export const TRIGGER_POLICY_LABELS = {
  publish: 'publishing.deployments.triggers.publish',
  change_set: 'publishing.deployments.triggers.changeSet',
  schema: 'publishing.deployments.triggers.schema',
  manual: 'publishing.deployments.triggers.manual',
} as const satisfies Record<DeploymentTriggerPolicy, string>;

export const RUN_TRIGGER_LABELS = {
  publish: 'publishing.deployments.runTriggers.publish',
  change_set: 'publishing.deployments.runTriggers.changeSet',
  schema: 'publishing.deployments.runTriggers.schema',
  manual: 'publishing.deployments.runTriggers.manual',
  retry: 'publishing.deployments.runTriggers.retry',
} as const;

export const TIMELINE_SOURCE_LABELS = {
  shapio: 'publishing.deployments.sources.shapio',
  callback: 'publishing.deployments.sources.callback',
  provider: 'publishing.deployments.sources.provider',
} as const;

/** Longest error text shown in a table cell; the full text is in the details. */
export const ERROR_PREVIEW_LENGTH = 120;
