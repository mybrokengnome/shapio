import type { FieldDefinition } from '@shapio/schema';
import type { ReactNode } from 'react';

type FieldGridProps = {
  fields: readonly FieldDefinition[];
  renderField: (field: FieldDefinition, className: string) => ReactNode;
};

/**
 * Short values sit two to a row when the form column itself is wide (title + slug, like the mockup); the
 * rest span the row. A container query, not a viewport breakpoint: the entry form's centre column sits
 * between two side panels, and splitting it on a wide screen left inputs a third of the column wide.
 */
const COMPACT_TYPES: ReadonlySet<string> = new Set([
  'string',
  'slug',
  'email',
  'url',
  'uid',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
]);

const isCompact = (field: FieldDefinition) =>
  COMPACT_TYPES.has(field.type) || (field.type === 'enum' && field.editor.id === 'select');

export const FieldGrid = ({ fields, renderField }: FieldGridProps) => (
  <div className="@container">
    <div className="grid gap-5 @2xl:grid-cols-2">
      {fields.map((field) => renderField(field, isCompact(field) ? '@2xl:col-span-1' : '@2xl:col-span-2'))}
    </div>
  </div>
);
