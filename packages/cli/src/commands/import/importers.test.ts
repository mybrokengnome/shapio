import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIo } from '../../types.js';
import { importCommand } from './index.js';

const run = async (args: string[], env: Record<string, string> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env };
  const code = await importCommand.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

describe('shapio import wordpress | strapi arguments', () => {
  it('needs exactly one of --plan and --map', async () => {
    const result = await run(['wordpress', 'export.xml']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Pass either --plan <dir> (with the export file) or --map <dir>');
    expect(result.stderr).toContain('Usage: shapio import wordpress');
  });

  it('needs the export file to plan and refuses it when mapping', async () => {
    expect((await run(['strapi', '--plan', 'out'])).stderr).toContain('--plan needs the export file');
    expect((await run(['strapi', 'x.tar.gz', '--map', 'out'])).stderr).toContain('leave the file out');
  });

  it('takes --shared on --plan only, and not with --workspace (or --site)', async () => {
    expect(
      (await run(['strapi', 'x.tar', '--plan', 'out', '--shared', '--workspace', 'blog'])).stderr,
    ).toContain('Pass either --workspace <key> or --shared, not both');
    expect((await run(['strapi', 'x.tar', '--plan', 'out', '--shared', '--site', 'blog'])).stderr).toContain(
      'Pass either --workspace <key> or --shared, not both',
    );
    expect((await run(['strapi', '--map', 'out', '--shared'])).stderr).toContain(
      '--shared is a --plan option',
    );
  });

  it('needs a token to map', async () => {
    const result = await run(['wordpress', '--map', 'out']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('An admin API token is required');
  });

  it('needs a token when --plan is given --url (SHAPIO_URL alone keeps the plan offline)', async () => {
    const dir = `/nonexistent-shapio-plan-${Date.now()}`;
    const result = await run(['strapi', 'x.tar', '--plan', dir, '--url', 'http://127.0.0.1:1']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '--plan --url checks names on that instance and needs an admin API token',
    );
  });

  it('still treats any other first argument as a bundle file', async () => {
    const result = await run(['bundle.ndjson']);
    expect(result.stderr).toContain('An admin API token is required');
  });
});

describe('shapio import --plan --url: which site names are checked on', () => {
  const WXR = fileURLToPath(new URL('../../../test/fixtures/wxr/blog.xml', import.meta.url));
  let scratch: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  /** An instance whose schema export answers for site `marketing` (the token's site, or the primary). */
  const stubInstance = () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ schemaVersion: 1, site: { id: 's2', key: 'marketing' }, definitions: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  const siteHeaders = (fetch: ReturnType<typeof stubInstance>) =>
    fetch.mock.calls.map((call) =>
      new Headers((call as unknown as [string, RequestInit])[1].headers).get('shapio-site'),
    );

  const planDir = async () => {
    scratch = await mkdtemp(join(tmpdir(), 'shapio-plan-'));
    return join(scratch, 'plan');
  };

  it('a shared plan names no site, so a site token is checked on its own site', async () => {
    const fetch = stubInstance();
    const dir = await planDir();
    const result = await run(['wordpress', WXR, '--plan', dir, '--shared', '--url', 'https://cms.test'], {
      SHAPIO_TOKEN: 'shp_test',
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(siteHeaders(fetch)).toEqual([null]);
  });

  it('with no site named, plans for the site the instance answers for and says so in the next steps', async () => {
    const fetch = stubInstance();
    const dir = await planDir();
    const result = await run(['wordpress', WXR, '--plan', dir, '--url', 'https://cms.test'], {
      SHAPIO_TOKEN: 'shp_test',
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    // The first request asks which site; the name check then reads that site's view.
    expect(siteHeaders(fetch)).toEqual([null, 'marketing']);
    expect(await readdir(join(dir, 'schema', 'sites'))).toEqual(['marketing']);
    expect(result.stdout).toContain('will belong to workspace "marketing"');
    expect(result.stdout).toContain('--workspace marketing');
  });

  it('offline, plans for the built-in site and still names it in the next steps', async () => {
    const dir = await planDir();
    const result = await run(['wordpress', WXR, '--plan', dir]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('will belong to workspace "default", the built-in workspace');
    expect(result.stdout).toContain('schema-lock.json --workspace default');
  });

  it('plans for the workspace --workspace, --site, SHAPIO_WORKSPACE or SHAPIO_SITE names', async () => {
    const cases: Array<[string[], Record<string, string>]> = [
      [['--workspace', 'blog'], {}],
      [['--site', 'blog'], {}],
      [['--workspace', 'blog', '--site', 'blog'], {}],
      [[], { SHAPIO_WORKSPACE: 'blog' }],
      [[], { SHAPIO_WORKSPACE: 'blog', SHAPIO_SITE: 'blog' }],
      [[], { SHAPIO_SITE: 'blog' }],
      // The flags win over the environment.
      [['--workspace', 'blog'], { SHAPIO_WORKSPACE: 'shop' }],
    ];
    for (const [flags, env] of cases) {
      const dir = await planDir();
      const result = await run(['wordpress', WXR, '--plan', dir, ...flags], env);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('will belong to workspace "blog"');
      expect(await readdir(join(dir, 'schema', 'sites'))).toEqual(['blog']);
      await rm(scratch ?? '', { recursive: true, force: true });
    }
  });

  it('refuses two different workspaces in the flags or in the environment', async () => {
    const dir = await planDir();
    const flags = await run(['wordpress', WXR, '--plan', dir, '--workspace', 'a', '--site', 'b']);
    expect(flags.code).toBe(1);
    expect(flags.stderr).toContain('--workspace "a" and --site "b" name different workspaces');
    const env = await run(['wordpress', WXR, '--plan', dir], {
      SHAPIO_WORKSPACE: 'a',
      SHAPIO_SITE: 'b',
    });
    expect(env.code).toBe(1);
    expect(env.stderr).toContain('SHAPIO_WORKSPACE "a" and SHAPIO_SITE "b" name different workspaces');
  });
});
