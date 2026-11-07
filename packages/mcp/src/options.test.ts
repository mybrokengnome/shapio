import { describe, expect, it } from 'vitest';
import { OptionsError, parseOptions, USAGE } from './options.js';

const ENV = { SHAPIO_URL: 'https://cms.example.com/cms/', SHAPIO_TOKEN: 'shp_x' };

describe('parseOptions', () => {
  it('reads the instance from the environment and the guards from flags', () => {
    expect(parseOptions([], ENV, '/work')).toEqual({
      baseUrl: 'https://cms.example.com/cms',
      token: 'shp_x',
      allowShip: false,
      mediaRoot: '/work',
    });
    expect(parseOptions(['--allow-ship', '--media-root', 'assets'], ENV, '/work')).toMatchObject({
      allowShip: true,
      mediaRoot: '/work/assets',
    });
    expect(parseOptions(['--help'], {}, '/work')).toBe('help');
  });

  it('refuses a missing URL or token and unknown flags', () => {
    expect(() => parseOptions([], { SHAPIO_TOKEN: 't' }, '/')).toThrow(OptionsError);
    expect(() => parseOptions([], { SHAPIO_URL: 'ftp://x', SHAPIO_TOKEN: 't' }, '/')).toThrow(/SHAPIO_URL/);
    expect(() => parseOptions([], { SHAPIO_URL: 'http://x' }, '/')).toThrow(/SHAPIO_TOKEN/);
    expect(() => parseOptions(['--ship'], ENV, '/')).toThrow(OptionsError);
  });

  it('reads the workspace from --workspace (or --site), else SHAPIO_WORKSPACE (or SHAPIO_SITE)', () => {
    expect(parseOptions([], ENV, '/')).not.toHaveProperty('site');
    expect(parseOptions(['--workspace', 'docs'], ENV, '/')).toMatchObject({ site: 'docs' });
    expect(parseOptions(['--site', 'docs'], ENV, '/')).toMatchObject({ site: 'docs' });
    expect(parseOptions([], { ...ENV, SHAPIO_WORKSPACE: 'marketing' }, '/')).toMatchObject({
      site: 'marketing',
    });
    expect(parseOptions([], { ...ENV, SHAPIO_SITE: 'marketing' }, '/')).toMatchObject({ site: 'marketing' });
    expect(
      parseOptions(['--workspace', 'docs'], { ...ENV, SHAPIO_WORKSPACE: 'marketing' }, '/'),
    ).toMatchObject({ site: 'docs' });
    expect(parseOptions([], { ...ENV, SHAPIO_SITE: '  ' }, '/')).not.toHaveProperty('site');
    expect(() => parseOptions(['--workspace', 'Marketing!'], ENV, '/')).toThrow(/workspace key/);
  });

  it('refuses two different workspaces in the flags or in the environment', () => {
    expect(() => parseOptions(['--workspace', 'a', '--site', 'b'], ENV, '/')).toThrow(
      '--workspace "a" and --site "b" name different workspaces',
    );
    expect(() => parseOptions([], { ...ENV, SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' }, '/')).toThrow(
      OptionsError,
    );
    expect(parseOptions(['--workspace', 'a', '--site', 'a'], ENV, '/')).toMatchObject({ site: 'a' });
  });

  it('documents --workspace and SHAPIO_WORKSPACE only', () => {
    expect(USAGE).toContain('--workspace <key>');
    expect(USAGE).toContain('SHAPIO_WORKSPACE');
    expect(USAGE).not.toMatch(/--site\b|SHAPIO_SITE|\bsites?\b/i);
  });
});
