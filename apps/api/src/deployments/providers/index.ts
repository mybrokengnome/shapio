import type { DeploymentProviderAdapter, DeploymentProviderId } from '../types.js';
import { cloudflarePagesProvider } from './cloudflarePages.js';
import { genericWebhookProvider } from './genericWebhook.js';
import { githubWriteBackProvider } from './githubWriteBack.js';

export const DEPLOYMENT_PROVIDERS: Readonly<Record<DeploymentProviderId, DeploymentProviderAdapter>> = {
  generic_webhook: genericWebhookProvider,
  cloudflare_pages: cloudflarePagesProvider,
  github: githubWriteBackProvider,
};

export const providerFor = (id: string): DeploymentProviderAdapter => {
  const provider = DEPLOYMENT_PROVIDERS[id as DeploymentProviderId] as DeploymentProviderAdapter | undefined;
  if (!provider) {
    throw new Error(`Unknown deployment provider "${id}"`);
  }
  return provider;
};
