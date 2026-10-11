import { FIELD_WIDTHS } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { model } from '../../../../../packages/schema/src/testing/fixtures';
import { fieldGridModeOf, WIDTH_CLASSES, widthClassOf } from './widthClasses';

describe('WIDTH_CLASSES', () => {
  it('maps every field width to a span of the six-column grid', () => {
    expect(Object.keys(WIDTH_CLASSES).sort()).toEqual([...FIELD_WIDTHS].sort());
    for (const width of FIELD_WIDTHS) {
      expect(WIDTH_CLASSES[width]).toMatch(/^@lg:col-span-[2-6]$/);
    }
  });

  it('spans the shares of the row', () => {
    expect(WIDTH_CLASSES.full).toBe('@lg:col-span-6');
    expect(WIDTH_CLASSES['two-thirds']).toBe('@lg:col-span-4');
    expect(WIDTH_CLASSES.half).toBe('@lg:col-span-3');
    expect(WIDTH_CLASSES.third).toBe('@lg:col-span-2');
  });

  it('treats an unset width as full', () => {
    expect(widthClassOf(undefined)).toBe(WIDTH_CLASSES.full);
  });
});

describe('fieldGridModeOf', () => {
  it('lays a form-layout model out by widths and a document one compactly', () => {
    expect(fieldGridModeOf(model({ display: { layout: 'form' } }))).toBe('widths');
    expect(fieldGridModeOf(model())).toBe('compact');
  });
});
