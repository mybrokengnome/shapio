import { describe, expect, it } from 'vitest';
import { isSecretEnvAllowed, parseEnvReference, resolveSecretValues } from './secretRefs.js';

describe('environment secret references', () => {
  it('recognises ${ENV:NAME} and nothing else', () => {
    expect(parseEnvReference('${ENV:CF_API_TOKEN}')).toBe('CF_API_TOKEN');
    expect(parseEnvReference(' ${ENV:_X1} ')).toBe('_X1');
    expect(parseEnvReference('${ENV:1BAD}')).toBeUndefined();
    expect(parseEnvReference('prefix ${ENV:X}')).toBeUndefined();
    expect(parseEnvReference('plain-token')).toBeUndefined();
  });

  it('resolves references from the environment, strictly or leniently', () => {
    const env = { CF_TOKEN: 'from-env' };
    const allowlist = ['CF_TOKEN', 'MISSING'];
    expect(
      resolveSecretValues({ deployHookUrl: 'x' }, { apiToken: 'CF_TOKEN' }, env, { strict: true, allowlist }),
    ).toEqual({
      deployHookUrl: 'x',
      apiToken: 'from-env',
    });
    expect(() => resolveSecretValues({}, { apiToken: 'MISSING' }, env, { strict: true, allowlist })).toThrow(
      /environment variable MISSING, which is not set/,
    );
    expect(resolveSecretValues({}, { apiToken: 'MISSING' }, env, { strict: false, allowlist })).toEqual({});
  });

  it('reads only variables set aside for secrets: SHAPIO_SECRET_* and SECRET_ENV_ALLOWLIST', () => {
    expect(isSecretEnvAllowed('SHAPIO_SECRET_CF', [])).toBe(true);
    expect(isSecretEnvAllowed('SESSION_SECRET', [])).toBe(false);
    expect(isSecretEnvAllowed('SMTP_PASSWORD', ['CF_PAGES_*'])).toBe(false);
    expect(isSecretEnvAllowed('CF_PAGES_TOKEN', ['CF_PAGES_*'])).toBe(true);
    expect(isSecretEnvAllowed('DEPLOY_KEY', ['DEPLOY_KEY'])).toBe(true);
    expect(isSecretEnvAllowed('DEPLOY_KEY_2', ['DEPLOY_KEY'])).toBe(false);
    const env = { SESSION_SECRET: 'x'.repeat(40) };
    expect(() =>
      resolveSecretValues({}, { signingSecret: 'SESSION_SECRET' }, env, { strict: true, allowlist: [] }),
    ).toThrow(
      /cannot come from SESSION_SECRET: environment references must name a variable that starts with SHAPIO_SECRET_ or is listed in SECRET_ENV_ALLOWLIST/,
    );
    expect(
      resolveSecretValues({}, { signingSecret: 'SESSION_SECRET' }, env, { strict: false, allowlist: [] }),
    ).toEqual({});
  });
});
