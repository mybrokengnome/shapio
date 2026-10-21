import { normalizeDefinition, type ClassifiedChange } from '@shapio/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { describeChange } from './describeChange';

beforeAll(async () => {
  await initI18n();
});

const change = (patch: Partial<ClassifiedChange>): ClassifiedChange =>
  ({ category: 'contract', breaking: false, destructive: false, ...patch }) as ClassifiedChange;

describe('describeChange for interfaces', () => {
  const names = (id: string) => (id === 'i1' ? 'Featurable' : undefined);

  it('names the interface a type starts or stops implementing', () => {
    expect(
      describeChange(change({ kind: 'model.implements', property: 'i1', from: null, to: 'i1' }), null, null, {
        definitionName: names,
      }),
    ).toBe('Implement Featurable');
    expect(
      describeChange(change({ kind: 'model.implements', property: 'i1', from: 'i1', to: null }), null, null, {
        definitionName: names,
      }),
    ).toBe('Stop implementing Featurable');
  });

  it('says what a new contract field requires of the members', () => {
    const featurable = normalizeDefinition({
      id: 'i1',
      kind: 'interface',
      apiKey: 'featurable',
      label: 'Featurable',
      fields: [{ id: 'f1', apiKey: 'image', label: 'Image', type: 'media' }],
    });
    expect(
      describeChange(change({ kind: 'field.added', fieldId: 'f1' }), null, featurable, { memberCount: 3 }),
    ).toBe('Featurable now requires image on 3 types');
  });
});
