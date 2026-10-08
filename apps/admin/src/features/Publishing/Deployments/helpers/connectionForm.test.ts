import { describe, expect, it } from 'vitest';
import {
  connectionSchema,
  EMPTY_CONNECTION,
  regenerableSecrets,
  toCreateConnectionInput,
  toUpdateConnectionInput,
  type ConnectionFormValues,
} from './connectionForm';

const github: ConnectionFormValues = {
  ...EMPTY_CONNECTION,
  name: 'Schema repo',
  provider: 'github',
  settings: { ...EMPTY_CONNECTION.settings, owner: 'acme', repo: 'site' },
  secrets: { ...EMPTY_CONNECTION.secrets, token: 'ghp_x' },
  triggerPolicy: ['schema', 'manual'],
};

const messagesOf = (mode: 'create' | 'edit', values: ConnectionFormValues) => {
  const result = connectionSchema(mode).safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
};

describe('connection form', () => {
  it('sends only the provider’s own settings and secrets', () => {
    expect(toCreateConnectionInput(github)).toEqual({
      name: 'Schema repo',
      provider: 'github',
      settings: { owner: 'acme', repo: 'site', branch: 'main', directory: 'schema', mode: 'commit' },
      secrets: { token: 'ghp_x' },
      previewUrlTemplate: null,
      triggerPolicy: ['schema', 'manual'],
      debounceSeconds: 30,
      allowPrivateNetwork: false,
      enabled: true,
      deliveryRoleId: null,
    });
    expect(toCreateConnectionInput({ ...github, deliveryRoleId: 'role-1' }).deliveryRoleId).toBe('role-1');
  });

  it('drops the schema trigger for providers other than GitHub', () => {
    const generic = { ...github, provider: 'generic_webhook' as const };
    expect(toCreateConnectionInput(generic).triggerPolicy).toEqual(['manual']);
  });

  it('keeps stored secrets on update unless a new value is typed', () => {
    const untouched = { ...github, secrets: { ...github.secrets, token: '' } };
    expect(toUpdateConnectionInput(untouched, 4)).not.toHaveProperty('secrets');
    expect(toUpdateConnectionInput(github, 4)).toMatchObject({
      secrets: { token: 'ghp_x' },
      expectedVersion: 4,
    });
    expect(toUpdateConnectionInput(github, 4)).not.toHaveProperty('provider');
  });

  it('asks for a new generated secret when an unreadable one is left empty', () => {
    const generic = {
      ...EMPTY_CONNECTION,
      name: 'Site',
      settings: { ...EMPTY_CONNECTION.settings, url: 'https://x.dev' },
    };
    const unset = { signingSecret: { set: false, envVar: null } };
    expect(
      regenerableSecrets({ provider: 'generic_webhook', secrets: unset, secretsUnreadable: true }),
    ).toEqual(['signingSecret']);
    expect(
      regenerableSecrets({ provider: 'generic_webhook', secrets: unset, secretsUnreadable: false }),
    ).toEqual([]);
    // A secret read from the environment is still readable: never replaced by a generated one.
    expect(
      regenerableSecrets({
        provider: 'generic_webhook',
        secrets: { signingSecret: { set: true, envVar: 'SIGNING' } },
        secretsUnreadable: true,
      }),
    ).toEqual([]);
    // Required secrets are never generated.
    expect(regenerableSecrets({ provider: 'github', secrets: {}, secretsUnreadable: true })).toEqual([]);

    expect(toUpdateConnectionInput(generic, 2, ['signingSecret'])).toMatchObject({
      secrets: { signingSecret: '' },
    });
    const typed = { ...generic, secrets: { ...generic.secrets, signingSecret: 'mine' } };
    expect(toUpdateConnectionInput(typed, 2, ['signingSecret'])).toMatchObject({
      secrets: { signingSecret: 'mine' },
    });
    expect(toUpdateConnectionInput(generic, 2)).not.toHaveProperty('secrets');
  });

  it('requires the provider’s settings, and its secrets only when creating', () => {
    const missing = {
      ...github,
      settings: { ...github.settings, repo: '' },
      secrets: { ...github.secrets, token: '' },
    };
    expect(messagesOf('create', missing)).toEqual([
      'settings.repo:validation.required',
      'secrets.token:validation.required',
    ]);
    expect(messagesOf('edit', missing)).toEqual(['settings.repo:validation.required']);
  });

  it('checks the generic webhook URL and the preview template', () => {
    const generic: ConnectionFormValues = {
      ...EMPTY_CONNECTION,
      name: 'Site',
      settings: { ...EMPTY_CONNECTION.settings, url: 'not a url' },
      previewUrlTemplate: 'preview.example.com/{path}',
    };
    expect(messagesOf('create', generic)).toEqual([
      'settings.url:validation.url',
      'previewUrlTemplate:validation.url',
    ]);
    const valid = {
      ...generic,
      settings: { ...generic.settings, url: 'https://hooks.example.com/build' },
      previewUrlTemplate: 'https://preview.example.com/{path}?token={token}',
    };
    expect(messagesOf('create', valid)).toEqual([]);
  });
});
