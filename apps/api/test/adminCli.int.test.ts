import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextTestIp } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const run = promisify(execFile);

describe('shapio admin create', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    // Boots once so the built-in roles exist and (SETUP_REQUIRE_TOKEN) a setup token is outstanding.
    testApp = await createTestApp(database.current, { env: { SETUP_REQUIRE_TOKEN: 'true' } });
  });
  afterAll(() => testApp.app.close());

  const cli = async (args: string[], env: Record<string, string> = {}) => {
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        ['--conditions=@shapio/source', '--import', 'tsx', 'src/cli.ts', ...args],
        {
          cwd: API_ROOT,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            DATABASE_URL: database.current.url,
            ...env,
          },
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };

  const loginStatus = (email: string, password: string) =>
    testApp.app
      .inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        remoteAddress: nextTestIp(),
        payload: { email, password },
      })
      .then((response) => response.statusCode);

  it('creates an owner with a generated password printed once, and kills outstanding setup tokens', async () => {
    const result = await cli(['admin', 'create', '--email', 'Ops@Example.com', '--name', 'Ops']);
    expect(result.code).toBe(0);
    const password = /Generated password .*: (\S+)/.exec(result.stdout)?.[1];
    expect(password).toBeDefined();
    expect(await loginStatus('ops@example.com', password ?? '')).toBe(200);
    const live = await testApp.db
      .selectFrom('setup_tokens')
      .select('id')
      .where('used_at', 'is', null)
      .where('superseded_at', 'is', null)
      .execute();
    expect(live).toEqual([]);
    const audit = await testApp.db
      .selectFrom('audit_events')
      .select(['actor_type', 'actor_id'])
      .where('action', '=', 'admin_user.create')
      .executeTakeFirstOrThrow();
    expect(audit).toEqual({ actor_type: 'system', actor_id: 'cli' });
  });

  it('takes the password from SHAPIO_ADMIN_PASSWORD and a role by key', async () => {
    const result = await cli(['admin', 'create', '--email=editor@example.com', '--role=editor'], {
      SHAPIO_ADMIN_PASSWORD: 'an environment passphrase',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('Generated password');
    expect(await loginStatus('editor@example.com', 'an environment passphrase')).toBe(200);
  });

  it('fails clearly on a duplicate email, an unknown role or missing arguments', async () => {
    const duplicate = await cli(['admin', 'create', '--email', 'ops@example.com']);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('already exists');
    const role = await cli(['admin', 'create', '--email', 'x@example.com', '--role', 'nope']);
    expect(role.code).toBe(1);
    expect(role.stderr).toContain('No admin role');
    const usage = await cli(['admin', 'create']);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Usage');
  });

  it('applies the sign-in rules: refuses a bad email, an over-long name, and a password sign-in would refuse', async () => {
    const password = { SHAPIO_ADMIN_PASSWORD: 'long enough password' };
    const notEmail = await cli(['admin', 'create', '--email', 'notanemail'], password);
    expect(notEmail).toMatchObject({ code: 1 });
    expect(notEmail.stderr).toContain('--email must be an email address');
    const longName = await cli(
      ['admin', 'create', '--email', 'n@example.com', '--name', 'N'.repeat(201)],
      password,
    );
    expect(longName).toMatchObject({ code: 1 });
    expect(longName.stderr).toContain('--name must be 1 to 200 characters');
    const longPassword = await cli(['admin', 'create', '--email', 'p@example.com'], {
      SHAPIO_ADMIN_PASSWORD: 'p'.repeat(5000),
    });
    expect(longPassword).toMatchObject({ code: 1 });
    expect(longPassword.stderr).toContain('SHAPIO_ADMIN_PASSWORD must be 12 to 256 characters');
    const shortPassword = await cli(['admin', 'create', '--email', 's@example.com'], {
      SHAPIO_ADMIN_PASSWORD: 'short',
    });
    expect(shortPassword).toMatchObject({ code: 1 });
    const created = await testApp.db
      .selectFrom('admin_users')
      .select('email')
      .where('email', 'in', ['notanemail', 'n@example.com', 'p@example.com', 's@example.com'])
      .execute();
    expect(created).toEqual([]);

    // The longest values the API accepts still work and can sign in.
    const longest = 'q'.repeat(256);
    const ok = await cli(['admin', 'create', '--email', 'max@example.com', '--name', 'N'.repeat(200)], {
      SHAPIO_ADMIN_PASSWORD: longest,
    });
    expect(ok, ok.stderr).toMatchObject({ code: 0 });
    expect(await loginStatus('max@example.com', longest)).toBe(200);
  });
});
