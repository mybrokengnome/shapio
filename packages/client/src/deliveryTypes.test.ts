import { describe, expectTypeOf, it } from 'vitest';
import type { DeliveryComponent, DeliveryComponentAttributes, DeliveryZoneItem } from './index.js';

type Link = { url: string | null };

describe('component item types', () => {
  it('carry a required id beside the fields', () => {
    expectTypeOf<DeliveryComponentAttributes>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<DeliveryComponent<Link>['id']>().toEqualTypeOf<string>();
    expectTypeOf<DeliveryComponent<Link>['url']>().toEqualTypeOf<string | null>();
  });

  it('give a dynamic zone item its id and __component', () => {
    expectTypeOf<DeliveryZoneItem<Link>>().toExtend<{
      id: string;
      __component: string;
      url: string | null;
    }>();
    expectTypeOf<{ url: null; __component: 'link' }>().not.toExtend<DeliveryZoneItem<Link>>();
  });
});
