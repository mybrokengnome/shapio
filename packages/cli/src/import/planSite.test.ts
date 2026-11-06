import { describe, expect, it } from 'vitest';
import { UsageError } from '../commands/export/http.js';
import { BUILT_IN_SITE_KEY, resolvePlanSite } from './planSite.js';

describe('resolvePlanSite', () => {
  it('plans for the primary site when nothing names one', () => {
    expect(resolvePlanSite({}, {})).toEqual({ site: BUILT_IN_SITE_KEY, explicit: false });
    expect(BUILT_IN_SITE_KEY).toBe('default');
  });

  it('takes --site, then SHAPIO_SITE', () => {
    expect(resolvePlanSite({ site: 'blog' }, { SHAPIO_SITE: 'shop' })).toEqual({
      site: 'blog',
      explicit: true,
    });
    expect(resolvePlanSite({}, { SHAPIO_SITE: 'shop' })).toEqual({ site: 'shop', explicit: true });
    expect(resolvePlanSite({ site: ' ' }, { SHAPIO_SITE: '' })).toEqual({
      site: BUILT_IN_SITE_KEY,
      explicit: false,
    });
  });

  it('plans shared models with --shared, which overrides SHAPIO_SITE but not --site', () => {
    expect(resolvePlanSite({ shared: true }, { SHAPIO_SITE: 'shop' })).toEqual({
      site: undefined,
      explicit: true,
    });
    expect(() => resolvePlanSite({ shared: true, site: 'blog' }, {})).toThrow(UsageError);
  });
});
