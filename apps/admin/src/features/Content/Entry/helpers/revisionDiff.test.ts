import { beforeAll, describe, expect, it } from 'vitest';
import { i18next, initI18n } from '@/app/i18n';
import { formatDateTime } from '@/helpers/formatDate';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { diffRevision } from './revisionDiff';

beforeAll(async () => {
  await initI18n();
});

const story = model({
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'subtitle', label: 'Subtitle' }),
    field({ apiKey: 'goesLive', label: 'Goes live', type: 'datetime' }),
  ],
});
const noComponents = new Map();

describe('diffRevision', () => {
  it('says a restore fills in a field that is empty now and clears one the old version left empty', () => {
    const changes = diffRevision(story, noComponents, { title: 'Old title' }, { title: '', subtitle: 'Now' });
    const byKey = new Map(changes.map((change) => [change.field.apiKey, change]));
    expect(byKey.get('title')?.kind).toBe('added');
    expect(byKey.get('subtitle')?.kind).toBe('removed');
    expect(i18next.t(`content.history.changes.${byKey.get('title')!.kind}`)).toBe('would be filled in');
    expect(i18next.t(`content.history.changes.${byKey.get('subtitle')!.kind}`)).toBe('would be cleared');
  });

  it('shows dates in the viewer’s time, not as raw UTC text', () => {
    const before = '2026-03-29T06:30:00.000Z';
    const after = '2026-03-08T07:30:00.000Z';
    const [change] = diffRevision(
      story,
      noComponents,
      { title: 'A', goesLive: after },
      { title: 'A', goesLive: before },
    );
    expect(change?.kind).toBe('changed');
    expect(change?.before).toBe(formatDateTime(before));
    expect(change?.after).toBe(formatDateTime(after));
    expect(change?.after).not.toContain('T07:30');
  });
});
