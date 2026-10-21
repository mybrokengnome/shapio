import { describe, expect, it } from 'vitest';
import { firstPermittedSection, permittedSections } from './sections';

describe('Deployments sections', () => {
  it('lists connections first, then scheduled and webhooks, as permitted', () => {
    expect(permittedSections(['publishing.manage', 'webhooks.manage']).map((section) => section.to)).toEqual([
      '/publishing/deployments',
      '/publishing/scheduled',
      '/publishing/webhooks',
    ]);
    expect(permittedSections([]).map((section) => section.to)).toEqual(['/publishing/deployments']);
  });

  it('lands everyone on the connections', () => {
    expect(firstPermittedSection(['publishing.manage', 'webhooks.manage'])).toBe('/publishing/deployments');
    expect(firstPermittedSection([])).toBe('/publishing/deployments');
  });
});
