import { PUBLISHING_JOBS } from '../constants/publishing.js';
import { createDeploymentPollHandler, createDeploymentTriggerHandler } from '../deployments/runs.js';
import { deploymentOutboxSubscriber } from '../deployments/subscriber.js';
import type { JobHandler, OutboxSubscriber } from '../jobs/types.js';
import { createWebhookDeliveryHandler } from '../webhooks/delivery.js';
import { webhookOutboxSubscriber } from '../webhooks/subscriber.js';
import { createChangeSetShipHandler } from './changeSetJobs.js';
import type { PublishingJobEnvironment } from './jobEnvironment.js';
import { createScheduledPublicationHandler } from './scheduling.js';

/** Package H's job handlers: scheduled publications, change sets, webhook deliveries, deploy triggers and polls. */
export const createPublishingJobHandlers = (
  environment: PublishingJobEnvironment,
): Array<[string, JobHandler]> => [
  [PUBLISHING_JOBS.scheduledPublication, createScheduledPublicationHandler(environment)],
  [PUBLISHING_JOBS.changeSetShip, createChangeSetShipHandler(environment)],
  [PUBLISHING_JOBS.webhookDeliver, createWebhookDeliveryHandler(environment.runtime)],
  [PUBLISHING_JOBS.deploymentTrigger, createDeploymentTriggerHandler(environment)],
  [PUBLISHING_JOBS.deploymentPoll, createDeploymentPollHandler(environment)],
];

/** Outbox subscribers: webhook deliveries and deployment triggers follow domain events (ADR 0007). */
export const PUBLISHING_OUTBOX_SUBSCRIBERS: readonly OutboxSubscriber[] = [
  webhookOutboxSubscriber,
  deploymentOutboxSubscriber,
];
