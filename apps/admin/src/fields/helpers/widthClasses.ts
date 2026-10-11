import { entryLayoutOf, type FieldWidth, type ModelDefinition } from '@shapio/schema';

/**
 * The six-column grid a form-layout entry lays its fields on (`FieldGrid` in width mode). A container query,
 * not a viewport breakpoint: below `@lg` (32rem) of the form column every field takes the whole row. `@lg`
 * keeps the row with the settings drawer open on a 1440px screen, where the column is about 630px wide.
 */
export const WIDTH_GRID_CLASSES = 'grid gap-5 @lg:grid-cols-6';

/** How many of the grid's six columns a field spans at each `FieldWidth`. Full class strings, never built. */
export const WIDTH_CLASSES = {
  full: '@lg:col-span-6',
  'two-thirds': '@lg:col-span-4',
  half: '@lg:col-span-3',
  third: '@lg:col-span-2',
} as const satisfies Record<FieldWidth, string>;

/** The span classes of a field's width; unset is `full`. */
export const widthClassOf = (width: FieldWidth | undefined): string => WIDTH_CLASSES[width ?? 'full'];

/**
 * How `FieldGrid` lays out a model's own fields: `compact` pairs short values up automatically (component
 * items, quick edit, a document-layout model); `widths` spans each field by its `width` (a form-layout model).
 */
export type FieldGridMode = 'compact' | 'widths';

/** The grid mode for an entry's own fields: `widths` when the model opens as a form. */
export const fieldGridModeOf = (model: ModelDefinition): FieldGridMode =>
  entryLayoutOf(model) === 'form' ? 'widths' : 'compact';
