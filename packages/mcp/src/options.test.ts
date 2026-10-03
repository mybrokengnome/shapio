import { describe, expect, it } from 'vitest';
import { OptionsError, parseOptions } from './options.js';

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

  it('reads the site from --site, else SHAPIO_SITE, and refuses an invalid key', () => {
    expect(parseOptions([], ENV, '/')).not.toHaveProperty('site');
    expect(parseOptions([], { ...ENV, SHAPIO_SITE: 'marketing' }, '/')).toMatchObject({ site: 'marketing' });
    expect(parseOptions(['--site', 'docs'], { ...ENV, SHAPIO_SITE: 'marketing' }, '/')).toMatchObject({
      site: 'docs',
    });
    expect(parseOptions([], { ...ENV, SHAPIO_SITE: '  ' }, '/')).not.toHaveProperty('site');
    expect(() => parseOptions(['--site', 'Marketing!'], ENV, '/')).toThrow(/site key/);
  });
});
