import { describe, expect, it } from 'vitest';
import {
  connectionSchema,
  EMPTY_CONNECTION,
  regenerableSecrets,
  toCreateConnectionInput,
  toConnectionValues,
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

/** The values a saved connection loads with: secrets are never prefilled. */
const loaded = (values: ConnectionFormValues): ConnectionFormValues => ({
  ...values,
  secrets: EMPTY_CONNECTION.secrets,
});

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
    const initial = loaded(github);
    const untouched = { ...github, secrets: { ...github.secrets, token: '' } };
    expect(toUpdateConnectionInput(untouched, { initial, expectedVersion: 4 })).toEqual({
      expectedVersion: 4,
    });
    expect(toUpdateConnectionInput(github, { initial, expectedVersion: 4 })).toEqual({
      secrets: { token: 'ghp_x' },
      expectedVersion: 4,
    });
    expect(toUpdateConnectionInput(github, { initial, expectedVersion: 4 })).not.toHaveProperty('provider');
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

    const update = (values: ConnectionFormValues, regenerable?: ['signingSecret']) =>
      toUpdateConnectionInput(values, { initial: generic, expectedVersion: 2, regenerable });
    expect(update(generic, ['signingSecret'])).toEqual({
      secrets: { signingSecret: '' },
      expectedVersion: 2,
    });
    const typed = { ...generic, secrets: { ...generic.secrets, signingSecret: 'mine' } };
    expect(update(typed, ['signingSecret'])).toMatchObject({ secrets: { signingSecret: 'mine' } });
    expect(update(generic)).not.toHaveProperty('secrets');
  });

  describe('editing a saved connection sends only what changed', () => {
    // A webhook on the server's own loopback, like a build hook behind a firewall that refuses such URLs.
    const saved = toConnectionValues({
      id: 'c1',
      name: 'Rebuild',
      provider: 'generic_webhook',
      settings: { url: 'http://127.0.0.1:4321/shapio' },
      secrets: { signingSecret: { set: true, envVar: null } },
      secretsUnreadable: false,
      previewUrlTemplate: 'http://127.0.0.1:4321/preview/{slug}',
      triggerPolicy: ['publish', 'change_set', 'manual'],
      debounceSeconds: 30,
      allowPrivateNetwork: true,
      enabled: true,
      deliveryRoleId: null,
      version: 7,
    } as unknown as Parameters<typeof toConnectionValues>[0]);
    const update = (values: ConnectionFormValues) =>
      toUpdateConnectionInput(values, { initial: saved, expectedVersion: 7 });

    it('a trigger unticked: the triggers and the version, no settings or URLs', () => {
      const body = update({ ...saved, triggerPolicy: ['change_set', 'manual'] });
      expect(body).toEqual({ triggerPolicy: ['change_set', 'manual'], expectedVersion: 7 });
      expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    });

    it('a trigger ticked again in another order is no change', () => {
      expect(update({ ...saved, triggerPolicy: ['manual', 'publish', 'change_set'] })).toEqual({
        expectedVersion: 7,
      });
    });

    it('a setting changed: the settings, whole (the server replaces them together)', () => {
      expect(
        update({ ...saved, settings: { ...saved.settings, url: 'https://hooks.example.com/build' } }),
      ).toEqual({ settings: { url: 'https://hooks.example.com/build' }, expectedVersion: 7 });
    });

    it('several fields changed: each of them, and nothing else', () => {
      expect(update({ ...saved, name: ' Rebuild site ', enabled: false, debounceSeconds: '60' })).toEqual({
        name: 'Rebuild site',
        enabled: false,
        debounceSeconds: 60,
        expectedVersion: 7,
      });
    });

    it('creating still sends everything', () => {
      expect(toCreateConnectionInput(saved)).toMatchObject({
        provider: 'generic_webhook',
        settings: { url: 'http://127.0.0.1:4321/shapio' },
        previewUrlTemplate: 'http://127.0.0.1:4321/preview/{slug}',
        triggerPolicy: ['publish', 'change_set', 'manual'],
        allowPrivateNetwork: true,
      });
    });
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
