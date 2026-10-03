import {
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_TRIGGERS,
  type CreateDeploymentConnectionInput,
  type DeploymentConnection,
  type DeploymentProvider,
  type UpdateDeploymentConnectionInput,
} from '@shapio/client';
import { z } from 'zod';
import { requiredText } from '@/helpers/validation';

export const GITHUB_MODES = ['commit', 'pull_request'] as const;

/** Select value for "previews show the public fields" (Radix selects cannot use an empty value). */
export const NO_DELIVERY_ROLE = 'none';

const SETTING_NAMES = [
  'url',
  'accountId',
  'projectName',
  'projectId',
  'teamId',
  'siteId',
  'owner',
  'repo',
  'branch',
  'mode',
  'directory',
] as const;
const SECRET_NAMES = ['signingSecret', 'deployHookUrl', 'apiToken', 'token'] as const;

export type SettingName = (typeof SETTING_NAMES)[number];
export type SecretName = (typeof SECRET_NAMES)[number];

type SecretSpec = { name: SecretName; requiredOnCreate: boolean };

/** Settings a provider shows but does not require (everything else listed in `settings` is required). */
export const OPTIONAL_SETTINGS: ReadonlySet<SettingName> = new Set(['teamId']);

/** The settings (text inputs; GitHub's `mode` is a select) and write-only secrets of each provider. */
export const PROVIDER_FIELDS = {
  generic_webhook: {
    settings: ['url'],
    secrets: [{ name: 'signingSecret', requiredOnCreate: false }],
  },
  cloudflare_pages: {
    settings: ['accountId', 'projectName'],
    secrets: [
      { name: 'deployHookUrl', requiredOnCreate: true },
      { name: 'apiToken', requiredOnCreate: true },
    ],
  },
  vercel: {
    settings: ['projectId', 'teamId'],
    secrets: [
      { name: 'deployHookUrl', requiredOnCreate: true },
      { name: 'apiToken', requiredOnCreate: true },
    ],
  },
  netlify: {
    settings: ['siteId'],
    secrets: [{ name: 'apiToken', requiredOnCreate: true }],
  },
  github: {
    settings: ['owner', 'repo', 'branch', 'directory'],
    secrets: [{ name: 'token', requiredOnCreate: true }],
  },
} as const satisfies Record<
  DeploymentProvider,
  { settings: readonly SettingName[]; secrets: readonly SecretSpec[] }
>;

/** Settings sent per provider (GitHub's `mode` included). */
const providerSettingNames = (provider: DeploymentProvider): readonly SettingName[] =>
  provider === 'github' ? [...PROVIDER_FIELDS.github.settings, 'mode'] : PROVIDER_FIELDS[provider].settings;

/** "Schema changes" only applies to GitHub, which commits the schema files. */
export const triggerOptionsFor = (provider: DeploymentProvider) =>
  DEPLOYMENT_TRIGGERS.filter((trigger) => trigger !== 'schema' || provider === 'github');

const isWholeNumber = (value: string) => /^\d+$/.test(value) && Number(value) <= 86_400;

const isHttpUrl = (value: string) => z.url({ protocol: /^https?$/ }).safeParse(value).success;

export type ConnectionFormMode = 'create' | 'edit';

const settingsShape = Object.fromEntries(SETTING_NAMES.map((name) => [name, z.string()])) as Record<
  SettingName,
  z.ZodString
>;
const secretsShape = Object.fromEntries(SECRET_NAMES.map((name) => [name, z.string()])) as Record<
  SecretName,
  z.ZodString
>;

/** Required settings and secrets depend on the provider; secrets are only required when creating. */
export const connectionSchema = (mode: ConnectionFormMode) =>
  z
    .object({
      name: requiredText().max(200, 'validation.tooLong'),
      provider: z.enum(DEPLOYMENT_PROVIDERS),
      settings: z.object(settingsShape),
      secrets: z.object(secretsShape),
      previewUrlTemplate: z.string().trim().max(2000, 'validation.tooLong'),
      triggerPolicy: z.array(z.enum(DEPLOYMENT_TRIGGERS)),
      debounceSeconds: z.string().trim().refine(isWholeNumber, 'validation.debounceSeconds'),
      allowPrivateNetwork: z.boolean(),
      enabled: z.boolean(),
      /** A delivery role ID, or NO_DELIVERY_ROLE. */
      deliveryRoleId: z.string(),
    })
    .superRefine((values, context) => {
      const fields = PROVIDER_FIELDS[values.provider];
      for (const name of fields.settings) {
        if (!OPTIONAL_SETTINGS.has(name) && values.settings[name].trim() === '') {
          context.addIssue({ code: 'custom', path: ['settings', name], message: 'validation.required' });
        }
      }
      if (
        values.provider === 'generic_webhook' &&
        values.settings.url.trim() &&
        !isHttpUrl(values.settings.url.trim())
      ) {
        context.addIssue({ code: 'custom', path: ['settings', 'url'], message: 'validation.url' });
      }
      if (mode === 'create') {
        for (const secret of fields.secrets) {
          if (secret.requiredOnCreate && values.secrets[secret.name].trim() === '') {
            context.addIssue({
              code: 'custom',
              path: ['secrets', secret.name],
              message: 'validation.required',
            });
          }
        }
      }
      if (values.previewUrlTemplate && !isHttpUrl(values.previewUrlTemplate)) {
        context.addIssue({ code: 'custom', path: ['previewUrlTemplate'], message: 'validation.url' });
      }
    });

export type ConnectionFormValues = z.infer<ReturnType<typeof connectionSchema>>;

const emptyRecord = <TName extends string>(names: readonly TName[]) =>
  Object.fromEntries(names.map((name) => [name, ''])) as Record<TName, string>;

export const EMPTY_CONNECTION: ConnectionFormValues = {
  name: '',
  provider: 'generic_webhook',
  settings: { ...emptyRecord(SETTING_NAMES), branch: 'main', mode: 'commit', directory: 'schema' },
  secrets: emptyRecord(SECRET_NAMES),
  previewUrlTemplate: '',
  triggerPolicy: ['publish', 'change_set', 'manual'],
  debounceSeconds: '30',
  allowPrivateNetwork: false,
  enabled: true,
  deliveryRoleId: NO_DELIVERY_ROLE,
};

export const toConnectionValues = (connection: DeploymentConnection): ConnectionFormValues => ({
  name: connection.name,
  provider: connection.provider,
  settings: {
    ...EMPTY_CONNECTION.settings,
    ...Object.fromEntries(
      SETTING_NAMES.flatMap((name) => (connection.settings[name] ? [[name, connection.settings[name]]] : [])),
    ),
  },
  // Secrets are write-only: never prefilled.
  secrets: emptyRecord(SECRET_NAMES),
  previewUrlTemplate: connection.previewUrlTemplate ?? '',
  triggerPolicy: connection.triggerPolicy,
  debounceSeconds: String(connection.debounceSeconds),
  allowPrivateNetwork: connection.allowPrivateNetwork,
  enabled: connection.enabled,
  deliveryRoleId: connection.deliveryRoleId ?? NO_DELIVERY_ROLE,
});

const commonInput = (values: ConnectionFormValues) => {
  const secrets = Object.fromEntries(
    PROVIDER_FIELDS[values.provider].secrets.flatMap(({ name }) =>
      values.secrets[name].trim() ? [[name, values.secrets[name].trim()]] : [],
    ),
  );
  return {
    name: values.name.trim(),
    settings: Object.fromEntries(
      providerSettingNames(values.provider).map((name) => [name, values.settings[name].trim()]),
    ),
    secrets,
    previewUrlTemplate: values.previewUrlTemplate.trim() || null,
    triggerPolicy: values.triggerPolicy.filter((trigger) =>
      triggerOptionsFor(values.provider).includes(trigger),
    ),
    debounceSeconds: Number(values.debounceSeconds),
    allowPrivateNetwork: values.allowPrivateNetwork,
    enabled: values.enabled,
    deliveryRoleId: values.deliveryRoleId === NO_DELIVERY_ROLE ? null : values.deliveryRoleId,
  };
};

export const toCreateConnectionInput = (values: ConnectionFormValues): CreateDeploymentConnectionInput => ({
  ...commonInput(values),
  provider: values.provider,
});

/** Only secrets typed in are sent: an omitted secret keeps its stored value. */
export const toUpdateConnectionInput = (
  values: ConnectionFormValues,
  expectedVersion: number,
): UpdateDeploymentConnectionInput => {
  const { secrets, ...rest } = commonInput(values);
  return { ...rest, ...(Object.keys(secrets).length > 0 ? { secrets } : {}), expectedVersion };
};
