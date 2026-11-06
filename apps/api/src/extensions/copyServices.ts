/**
 * A new object with the properties of `base`, then those of `overrides`, copied as property descriptors:
 * an accessor (the top-level `services.site`, which follows the primary site) stays an accessor, where an
 * object spread would read it once and keep that value.
 */
export const copyServices = <Base extends object, Overrides extends object>(
  base: Base,
  overrides?: Overrides,
): Omit<Base, keyof Overrides> & Overrides =>
  Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(base),
      ...(overrides ? Object.getOwnPropertyDescriptors(overrides) : {}),
    },
  ) as Omit<Base, keyof Overrides> & Overrides;
