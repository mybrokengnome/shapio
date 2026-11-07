import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const run = promisify(execFile);

describe('shapio workspaces (and the hidden `sites` alias)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    // Boots once so the migrations ran and the built-in workspace exists.
    testApp = await createTestApp(database.current);
  });
  afterAll(() => testApp.app.close());

  const cli = async (args: string[]) => {
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
          },
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };

  it('creates and lists workspaces; `shapio sites` still does the same', async () => {
    const created = await cli(['workspaces', 'create', '--key', 'docs', '--name', 'Docs']);
    expect(created.stderr).toBe('');
    expect(created).toMatchObject({ code: 0 });
    expect(created.stdout).toMatch(/^Created workspace docs \(.+\)\.\n$/);
    const viaAlias = await cli(['sites', 'create', '--key', 'shop', '--name', 'Shop']);
    expect(viaAlias.stdout).toMatch(/^Created workspace shop \(.+\)\.\n$/);

    for (const command of ['workspaces', 'sites']) {
      const listed = await cli([command, 'list']);
      expect(listed.code).toBe(0);
      const lines = listed.stdout.trim().split('\n');
      expect(lines).toContain('docs\tDocs');
      expect(lines).toContain('shop\tShop');
      expect(lines.filter((line) => line.endsWith('\t(primary)'))).toHaveLength(1);
    }
  });

  it('prints the workspaces usage on a bad command line', async () => {
    const usage = await cli(['workspaces', 'create', '--key', 'Not A Key', '--name', 'x']);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Usage: shapio workspaces list');
    expect((await cli(['sites'])).stderr).toContain('Usage: shapio workspaces list');
  });
});
