import { describe, expectTypeOf, it } from 'vitest';
import type { ComponentValue, DynamicZoneItem } from './types.js';

describe('component values', () => {
  it('carry an optional id: stored items have one, new items do not', () => {
    expectTypeOf<ComponentValue['id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<{ title: 'New' }>().toExtend<ComponentValue>();
    expectTypeOf<{ id: string; title: 'Kept' }>().toExtend<ComponentValue>();
    expectTypeOf<{ id: string; __component: 'hero' }>().toExtend<DynamicZoneItem>();
  });
});
