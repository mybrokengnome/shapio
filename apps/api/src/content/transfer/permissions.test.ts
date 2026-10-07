import { describe, expect, it } from 'vitest';
import { keepKnownGrants, mergeWithTargetGrants } from './permissions.js';

const grant = (modelId: string | null) => ({ action: 'read', modelId, condition: null, fieldIds: null });
const known = new Set(['story']);

describe('keepKnownGrants', () => {
  it('keeps a role whose grants are all on known models or on all models, unchanged', () => {
    const role = { key: 'site', permissions: [grant('story'), grant(null)] };
    expect(keepKnownGrants(role, known)).toEqual({ role, dropped: undefined });
  });

  it('drops the grants on unknown models and says which', () => {
    const role = { key: 'mixed', permissions: [grant('story'), grant('secret'), grant('secret')] };
    expect(keepKnownGrants(role, known)).toEqual({
      role: { key: 'mixed', permissions: [grant('story')] },
      dropped: { role: 'mixed', modelIds: ['secret'] },
    });
  });

  it('leaves out a role whose grants were all on unknown models', () => {
    const role = { key: 'other', permissions: [grant('secret')] };
    expect(keepKnownGrants(role, known)).toEqual({
      role: undefined,
      dropped: { role: 'other', modelIds: ['secret'] },
    });
  });

  it('keeps a role with no grants at all', () => {
    const role = { key: 'empty', permissions: [] };
    expect(keepKnownGrants(role, known)).toEqual({ role, dropped: undefined });
  });
});

describe('mergeWithTargetGrants', () => {
  it('takes the bundle’s grants on its models and the target’s on every other model', () => {
    const fromBundle = { key: 'site', permissions: [grant('story'), grant(null)] };
    const onTarget = [grant('story'), grant('secret'), grant(null)];
    expect(mergeWithTargetGrants(fromBundle, onTarget, known).permissions).toEqual([
      grant('story'),
      grant(null),
      grant('secret'),
    ]);
  });

  it('drops the bundle’s grants on models outside it in favour of the target’s', () => {
    const fromBundle = { key: 'site', permissions: [grant('story'), grant('secret')] };
    expect(mergeWithTargetGrants(fromBundle, [], known).permissions).toEqual([grant('story')]);
  });
});
