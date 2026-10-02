import { DEPLOYMENT_PROVIDERS, DEPLOYMENT_RUN_STATUSES, SCHEDULE_STATUSES } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en/translation.json';
import { DELIVERY_STATUS_DISPLAY, runDisplay, SCHEDULE_STATUS_DISPLAY } from './statusDisplay';

const translate = (key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en);

const run = (status: (typeof DEPLOYMENT_RUN_STATUSES)[number], overrides = {}) => ({
  status,
  provider: 'generic_webhook' as const,
  completionReported: true,
  ...overrides,
});

describe('runDisplay', () => {
  it('never claims a deployment when completion cannot be reported', () => {
    const display = runDisplay(run('triggered', { completionReported: false }));
    expect(translate(display.labelKey)).toBe('Trigger sent · completion unknown');
    expect(display.tone).toBe('muted');
  });

  it('says "Trigger sent" when the provider will report completion', () => {
    expect(translate(runDisplay(run('triggered')).labelKey)).toBe('Trigger sent');
  });

  it('labels a GitHub success as a commit, other providers as deployed', () => {
    expect(translate(runDisplay(run('deployed', { provider: 'github' })).labelKey)).toBe('Committed');
    expect(translate(runDisplay(run('deployed', { provider: 'cloudflare_pages' })).labelKey)).toBe(
      'Deployed',
    );
  });

  it.each([
    ['queued', 'Queued'],
    ['building', 'Building'],
    ['failed', 'Failed'],
    ['unknown', 'Status unknown'],
  ] as const)('%s reads "%s"', (status, label) => {
    expect(translate(runDisplay(run(status)).labelKey)).toBe(label);
  });

  it('shows success only for a deployed run', () => {
    for (const provider of DEPLOYMENT_PROVIDERS) {
      for (const status of DEPLOYMENT_RUN_STATUSES) {
        for (const completionReported of [true, false]) {
          const { tone } = runDisplay({ status, provider, completionReported });
          expect(tone === 'success').toBe(status === 'deployed');
        }
      }
    }
  });
});

describe('status labels', () => {
  it.each([
    ['schedule', SCHEDULE_STATUSES, SCHEDULE_STATUS_DISPLAY],
    ['delivery', ['pending', 'retrying', 'succeeded', 'dead'], DELIVERY_STATUS_DISPLAY],
  ] as const)('every %s status has a translated label', (_name, statuses, display) => {
    for (const status of statuses) {
      const entry = (display as Record<string, { labelKey: string }>)[status];
      expect(typeof translate(entry?.labelKey ?? '')).toBe('string');
    }
  });
});
