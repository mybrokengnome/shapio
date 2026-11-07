import { describe, expect, it } from 'vitest';
import { UsageError } from './usageError.js';
import { resolveWorkspace, workspaceFromEnv, workspaceFromFlags } from './workspace.js';

describe('resolveWorkspace', () => {
  it('reads --workspace, else --site, and ignores blank values', () => {
    expect(workspaceFromFlags({ workspace: 'blog' })).toBe('blog');
    expect(workspaceFromFlags({ site: 'blog' })).toBe('blog');
    expect(workspaceFromFlags({ workspace: ' blog ', site: 'blog' })).toBe('blog');
    expect(workspaceFromFlags({ workspace: ' ', site: '' })).toBeUndefined();
    expect(workspaceFromFlags({})).toBeUndefined();
  });

  it('reads SHAPIO_WORKSPACE, else SHAPIO_SITE', () => {
    expect(workspaceFromEnv({ SHAPIO_WORKSPACE: 'blog' })).toBe('blog');
    expect(workspaceFromEnv({ SHAPIO_SITE: 'blog' })).toBe('blog');
    expect(workspaceFromEnv({ SHAPIO_WORKSPACE: '', SHAPIO_SITE: 'blog' })).toBe('blog');
    expect(workspaceFromEnv({})).toBeUndefined();
  });

  it('refuses two different keys within a pair', () => {
    expect(() => workspaceFromFlags({ workspace: 'a', site: 'b' })).toThrow(UsageError);
    expect(() => workspaceFromFlags({ workspace: 'a', site: 'b' })).toThrow(
      '--workspace "a" and --site "b" name different workspaces: set one of them',
    );
    expect(() => workspaceFromEnv({ SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' })).toThrow(
      'SHAPIO_WORKSPACE "a" and SHAPIO_SITE "b" name different workspaces: set one of them',
    );
  });

  it('takes the flags over the environment, which it then does not check', () => {
    expect(resolveWorkspace({ site: 'blog' }, { SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' })).toBe('blog');
    expect(resolveWorkspace({}, { SHAPIO_WORKSPACE: 'shop', SHAPIO_SITE: 'shop' })).toBe('shop');
    expect(resolveWorkspace({}, {})).toBeUndefined();
  });
});
