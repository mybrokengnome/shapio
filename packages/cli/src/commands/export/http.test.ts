import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../types.js';
import { parseTransferArgs, UsageError } from './http.js';
import { exportCommand } from './index.js';

const io = (env: Record<string, string> = {}): CliIo => ({
  stdout: () => undefined,
  stderr: () => undefined,
  env: { SHAPIO_TOKEN: 'shp_test', ...env },
});

const workspaceOf = (args: string[], env: Record<string, string> = {}) =>
  parseTransferArgs([...args, 'bundle.ndjson'], io(env), []).connection.site;

describe('export and import: the workspace', () => {
  it('takes --workspace or --site, else SHAPIO_WORKSPACE or SHAPIO_SITE', () => {
    expect(workspaceOf(['--workspace', 'blog'])).toBe('blog');
    expect(workspaceOf(['--site', 'blog'])).toBe('blog');
    expect(workspaceOf([], { SHAPIO_WORKSPACE: 'blog' })).toBe('blog');
    expect(workspaceOf([], { SHAPIO_SITE: 'blog' })).toBe('blog');
    expect(workspaceOf(['--workspace', 'docs'], { SHAPIO_SITE: 'blog' })).toBe('docs');
    expect(workspaceOf([])).toBeUndefined();
  });

  it('refuses two different workspaces', async () => {
    expect(() => workspaceOf(['--workspace', 'a', '--site', 'b'])).toThrow(UsageError);
    expect(() => workspaceOf([], { SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' })).toThrow(UsageError);
    let stderr = '';
    const code = await exportCommand.run(['--workspace', 'a', '--site', 'b', 'out.ndjson'], {
      ...io(),
      stderr: (text) => (stderr += text),
    });
    expect(code).toBe(1);
    expect(stderr).toContain('shapio export: --workspace "a" and --site "b" name different workspaces');
  });
});
