import { describe, expect, it } from 'vitest';
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

  it('takes --shared on --plan only, and not with --site', async () => {
    expect((await run(['strapi', 'x.tar', '--plan', 'out', '--shared', '--site', 'blog'])).stderr).toContain(
      'Pass either --site <key> or --shared, not both',
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
