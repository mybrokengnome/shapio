import { describe, expect, it } from 'vitest';
import { UsageError } from '../commands/export/http.js';
import { BUILT_IN_SITE_KEY, resolvePlanSite } from './planSite.js';

describe('resolvePlanSite', () => {
  it('plans for the primary workspace when nothing names one', () => {
    expect(resolvePlanSite({}, {})).toEqual({ site: BUILT_IN_SITE_KEY, explicit: false });
    expect(BUILT_IN_SITE_KEY).toBe('default');
  });

  it('takes --workspace (or --site), then SHAPIO_WORKSPACE (or SHAPIO_SITE)', () => {
    expect(resolvePlanSite({ workspace: 'blog' }, { SHAPIO_WORKSPACE: 'shop' })).toEqual({
      site: 'blog',
      explicit: true,
    });
    expect(resolvePlanSite({ site: 'blog' }, { SHAPIO_SITE: 'shop' })).toEqual({
      site: 'blog',
      explicit: true,
    });
    expect(resolvePlanSite({}, { SHAPIO_WORKSPACE: 'shop' })).toEqual({ site: 'shop', explicit: true });
    expect(resolvePlanSite({}, { SHAPIO_SITE: 'shop' })).toEqual({ site: 'shop', explicit: true });
    expect(resolvePlanSite({ site: ' ' }, { SHAPIO_SITE: '' })).toEqual({
      site: BUILT_IN_SITE_KEY,
      explicit: false,
    });
  });

  it('plans shared models with --shared, which overrides the environment but not a flag', () => {
    expect(resolvePlanSite({ shared: true }, { SHAPIO_WORKSPACE: 'shop' })).toEqual({
      site: undefined,
      explicit: true,
    });
    expect(() => resolvePlanSite({ shared: true, workspace: 'blog' }, {})).toThrow(UsageError);
    expect(() => resolvePlanSite({ shared: true, site: 'blog' }, {})).toThrow(UsageError);
  });

  it('refuses two different workspaces in the flags or in the environment', () => {
    expect(() => resolvePlanSite({ workspace: 'a', site: 'b' }, {})).toThrow(UsageError);
    expect(() => resolvePlanSite({}, { SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' })).toThrow(UsageError);
  });
});
