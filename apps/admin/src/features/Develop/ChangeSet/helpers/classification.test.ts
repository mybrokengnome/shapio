import type { ClassifiedChange } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { classOfChange, signOfChange } from './classification';

const change = (overrides: Partial<ClassifiedChange>): ClassifiedChange => ({
  kind: 'field.metadata',
  definitionId: 'model',
  category: 'metadata',
  breaking: false,
  destructive: false,
  supported: true,
  prerequisites: [],
  cleanup: [],
  ...overrides,
});

describe('classOfChange', () => {
  it('reads breaking or destructive changes as breaking, whatever their category', () => {
    expect(classOfChange(change({ category: 'conversion', breaking: true }))).toBe('breaking');
    expect(classOfChange(change({ category: 'removal', destructive: true }))).toBe('breaking');
  });

  it('maps categories to conversion, validation, additive and metadata', () => {
    expect(classOfChange(change({ category: 'conversion' }))).toBe('conversion');
    expect(classOfChange(change({ category: 'requiredField' }))).toBe('validation');
    expect(classOfChange(change({ category: 'constraint' }))).toBe('validation');
    expect(classOfChange(change({ category: 'additive' }))).toBe('additive');
    expect(classOfChange(change({ category: 'editorSwap' }))).toBe('metadata');
  });
});

describe('signOfChange', () => {
  it('marks additions, removals and in-place changes', () => {
    expect(signOfChange({ kind: 'field.added' })).toBe('+');
    expect(signOfChange({ kind: 'definition.removed' })).toBe('−');
    expect(signOfChange({ kind: 'field.type' })).toBe('~');
  });
});
