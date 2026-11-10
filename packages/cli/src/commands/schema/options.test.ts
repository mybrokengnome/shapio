import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../types.js';
import { parseSchemaOptions, UsageError } from './options.js';
import { schemaCommand } from './index.js';

const io = (env: Record<string, string> = {}): CliIo => ({
  stdout: () => undefined,
  stderr: () => undefined,
  env: { SHAPIO_TOKEN: 'shp_test', ...env },
});

describe('schema commands: the workspace', () => {
  it('takes --workspace, or --site, its older name', () => {
    expect(parseSchemaOptions(['--workspace', 'blog'], io()).site).toBe('blog');
    expect(parseSchemaOptions(['--site', 'blog'], io()).site).toBe('blog');
    expect(parseSchemaOptions(['--workspace=blog', '--site=blog'], io()).site).toBe('blog');
  });

  it('falls back to SHAPIO_WORKSPACE, then SHAPIO_SITE; a flag wins', () => {
    expect(parseSchemaOptions([], io({ SHAPIO_WORKSPACE: 'blog' })).site).toBe('blog');
    expect(parseSchemaOptions([], io({ SHAPIO_SITE: 'blog' })).site).toBe('blog');
    expect(parseSchemaOptions(['--workspace', 'docs'], io({ SHAPIO_WORKSPACE: 'blog' })).site).toBe('docs');
    expect(parseSchemaOptions([], io())).not.toHaveProperty('site');
  });

  it('refuses two different workspaces in the flags or in the environment', () => {
    expect(() => parseSchemaOptions(['--workspace', 'a', '--site', 'b'], io())).toThrow(UsageError);
    expect(() => parseSchemaOptions([], io({ SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' }))).toThrow(
      'SHAPIO_WORKSPACE "a" and SHAPIO_SITE "b" name different workspaces',
    );
  });

  it('prints a refusal as a usage error, not a stack', async () => {
    let stderr = '';
    const code = await schemaCommand.run(['pull', '--workspace', 'a', '--site', 'b'], {
      ...io(),
      stderr: (text) => (stderr += text),
    });
    expect(code).toBe(1);
    expect(stderr).toBe(
      'shapio schema pull: --workspace "a" and --site "b" name different workspaces: set one of them\n',
    );
  });

  it('scope needs --workspace (or --site) or --shared, not the environment alone', async () => {
    let stderr = '';
    const run = (args: string[], env: Record<string, string> = {}) =>
      schemaCommand.run(['scope', 'post', ...args], { ...io(env), stderr: (text) => (stderr += text) });
    expect(await run([], { SHAPIO_WORKSPACE: 'blog' })).toBe(1);
    expect(stderr).toContain(
      'Pass --workspace <key> to keep it in that workspace, or --shared to share it with all workspaces',
    );
  });

  it('documents --workspace only', () => {
    const help: string[] = [];
    void schemaCommand.run(['help'], { ...io(), stdout: (text) => help.push(text) });
    expect(help.join('')).toContain('--workspace <key>');
    expect(help.join('')).not.toMatch(/--site\b/);
  });
});
