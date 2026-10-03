import type { DeploymentProvider } from '@shapio/client';
import type { SecretName, SettingName } from './connectionForm';

export const SETTING_LABELS = {
  url: 'publishing.deployments.settingLabels.url',
  accountId: 'publishing.deployments.settingLabels.accountId',
  projectName: 'publishing.deployments.settingLabels.projectName',
  projectId: 'publishing.deployments.settingLabels.projectId',
  teamId: 'publishing.deployments.settingLabels.teamId',
  siteId: 'publishing.deployments.settingLabels.siteId',
  owner: 'publishing.deployments.settingLabels.owner',
  repo: 'publishing.deployments.settingLabels.repo',
  branch: 'publishing.deployments.settingLabels.branch',
  mode: 'publishing.deployments.settingLabels.mode',
  directory: 'publishing.deployments.settingLabels.directory',
} as const satisfies Record<SettingName, string>;

export const SETTING_HINTS = {
  url: 'publishing.deployments.settingHints.url',
  directory: 'publishing.deployments.settingHints.directory',
  teamId: 'publishing.deployments.settingHints.teamId',
} as const satisfies Partial<Record<SettingName, string>>;

export const SECRET_LABELS = {
  signingSecret: 'publishing.deployments.secretLabels.signingSecret',
  deployHookUrl: 'publishing.deployments.secretLabels.deployHookUrl',
  apiToken: 'publishing.deployments.secretLabels.apiToken',
  token: 'publishing.deployments.secretLabels.token',
} as const satisfies Record<SecretName, string>;

export const SECRET_HINTS = {
  signingSecret: 'publishing.deployments.secretHints.signingSecret',
  deployHookUrl: 'publishing.deployments.secretHints.deployHookUrl',
  apiToken: 'publishing.deployments.secretHints.apiToken',
  token: 'publishing.deployments.secretHints.token',
} as const satisfies Record<SecretName, string>;

type SecretHintKey =
  (typeof SECRET_HINTS)[SecretName] | 'publishing.deployments.providerSecretHints.netlify.apiToken';

/** Where a secret means something different for one provider (Netlify's token also starts builds). */
const PROVIDER_SECRET_HINTS: Partial<Record<DeploymentProvider, Partial<Record<SecretName, SecretHintKey>>>> =
  {
    netlify: { apiToken: 'publishing.deployments.providerSecretHints.netlify.apiToken' },
  };

/** The hint for a provider's secret: its provider-specific override, or the shared one. */
export const secretHintFor = (provider: DeploymentProvider, name: SecretName): SecretHintKey =>
  PROVIDER_SECRET_HINTS[provider]?.[name] ?? SECRET_HINTS[name];

export const GITHUB_MODE_LABELS = {
  commit: 'publishing.deployments.githubModes.commit',
  pull_request: 'publishing.deployments.githubModes.pull_request',
} as const;
