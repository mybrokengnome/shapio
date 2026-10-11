import type { FieldDefinition } from '@shapio/schema';
import { FieldGrid } from '../../FieldGrid';
import type { FieldGridMode } from '../../helpers/widthClasses';
import { EntrySiblings } from '../EntrySiblings';
import { TopLevelField } from '../TopLevelField';

type EntryFieldsProps = {
  fields: readonly FieldDefinition[];
  /** `widths` for a form-layout entry (each field at its `width`); quick edit keeps the compact split. */
  mode?: FieldGridMode;
};

/** The entry's own fields (one section of the form). */
export const EntryFields = ({ fields, mode }: EntryFieldsProps) => (
  <EntrySiblings>
    <FieldGrid
      fields={fields}
      mode={mode}
      renderField={(field, className) => (
        <TopLevelField key={field.id} field={field} layout="stacked" className={className} />
      )}
    />
  </EntrySiblings>
);
