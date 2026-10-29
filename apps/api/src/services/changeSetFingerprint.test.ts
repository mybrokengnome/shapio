import { describe, expect, it } from 'vitest';
import { openFingerprint, shippedFingerprint, type FingerprintItem } from './changeSetFingerprint.js';

const entryItem = (id: string, overrides: Partial<FingerprintItem> = {}): FingerprintItem => ({
  id,
  kind: 'entry',
  action: 'publish',
  source_revision_id: null,
  entry_id: `entry-${id}`,
  locale: 'en',
  ...overrides,
});

const schemaItem = (id: string): FingerprintItem => ({
  id,
  kind: 'schema',
  action: null,
  source_revision_id: null,
  entry_id: null,
  locale: null,
});

const base = {
  items: [entryItem('a'), entryItem('b', { action: 'unpublish' }), schemaItem('s')],
  draftVersions: [
    { entry_id: 'entry-a', locale: 'en', version: 3 },
    { entry_id: 'entry-b', locale: 'en', version: 7 },
  ],
  drafts: [{ id: 'draft-1', version: 2 }],
};

describe('openFingerprint (plan approval)', () => {
  it('is stable across item order and across drafts no item publishes', () => {
    const reordered = { ...base, items: [...base.items].reverse(), drafts: [...base.drafts] };
    expect(openFingerprint(reordered)).toBe(openFingerprint(base));
    // entry-b is unpublished, not published from its draft: its draft version does not count.
    const otherDraft = {
      ...base,
      draftVersions: [base.draftVersions[0], { entry_id: 'entry-b', locale: 'en', version: 99 }],
    } as typeof base;
    expect(openFingerprint(otherDraft)).toBe(openFingerprint(base));
  });

  it('changes when an item, a published draft or a schema draft changes', () => {
    const fingerprint = openFingerprint(base);
    expect(openFingerprint({ ...base, items: base.items.slice(1) })).not.toBe(fingerprint);
    expect(
      openFingerprint({
        ...base,
        items: [entryItem('a', { action: 'unpublish' }), ...base.items.slice(1)],
      }),
    ).not.toBe(fingerprint);
    expect(
      openFingerprint({
        ...base,
        draftVersions: [{ entry_id: 'entry-a', locale: 'en', version: 4 }, base.draftVersions[1]],
      } as typeof base),
    ).not.toBe(fingerprint);
    expect(openFingerprint({ ...base, drafts: [{ id: 'draft-1', version: 3 }] })).not.toBe(fingerprint);
  });

  it('ignores the draft of an item that publishes a fixed revision (restore items)', () => {
    const restore = { ...base, items: [entryItem('a', { source_revision_id: 'rev-1' })] };
    const moved = {
      ...restore,
      draftVersions: [{ entry_id: 'entry-a', locale: 'en', version: 40 }],
    };
    expect(openFingerprint(moved)).toBe(openFingerprint(restore));
  });
});

describe('shippedFingerprint (plan approval)', () => {
  it('reads only what shipped: the items and the snapshot', () => {
    const fingerprint = shippedFingerprint({ items: base.items, shippedSeq: 12 });
    expect(shippedFingerprint({ items: [...base.items].reverse(), shippedSeq: 12 })).toBe(fingerprint);
    expect(shippedFingerprint({ items: base.items, shippedSeq: 13 })).not.toBe(fingerprint);
    expect(fingerprint).not.toBe(openFingerprint(base));
  });
});
