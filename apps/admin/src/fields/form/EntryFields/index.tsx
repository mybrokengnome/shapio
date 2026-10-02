import type { FieldDefinition } from '@shapio/schema';
import { FieldGrid } from '../../FieldGrid';
import { EntrySiblings } from '../EntrySiblings';
import { TopLevelField } from '../TopLevelField';

type EntryFieldsProps = { fields: readonly FieldDefinition[] };

/** The entry's own fields (one section of the form). */
export const EntryFields = ({ fields }: EntryFieldsProps) => (
  <EntrySiblings>
    <FieldGrid
      fields={fields}
      renderField={(field, className) => <TopLevelField key={field.id} field={field} className={className} />}
    />
  </EntrySiblings>
);
