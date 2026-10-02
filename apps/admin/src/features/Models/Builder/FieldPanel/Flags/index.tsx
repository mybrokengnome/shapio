import {
  SCALAR_DATA_TYPES,
  UNIQUE_CAPABLE_DATA_TYPES,
  type FieldDefinition,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { SwitchControl } from '../../controls/SwitchControl';

type FlagKey = 'required' | 'unique' | 'localized' | 'public' | 'filterable' | 'sortable' | 'deprecated';

type FlagsProps = {
  field: FieldDefinition;
  draft: SchemaDefinition;
  /** The issues on one of the field's properties. */
  at: (property: string) => readonly ValidationIssue[];
  disabled: boolean;
  onChange: (patch: Partial<Pick<FieldDefinition, FlagKey>>) => void;
};

const FLAG_KEYS = {
  required: { label: 'models.builder.required', hint: 'models.builder.requiredHint' },
  unique: { label: 'models.builder.unique', hint: 'models.builder.uniqueHint' },
  localized: { label: 'models.builder.fieldLocalized', hint: 'models.builder.fieldLocalizedHint' },
  public: { label: 'models.builder.public', hint: 'models.builder.publicHint' },
  filterable: { label: 'models.builder.filterable', hint: 'models.builder.indexHint' },
  sortable: { label: 'models.builder.sortable', hint: 'models.builder.indexHint' },
  deprecated: { label: 'models.builder.deprecated', hint: 'models.builder.deprecatedHint' },
} as const satisfies Record<FlagKey, { label: string; hint: string }>;

/** The on/off options a field of this type supports here (components have no indexes or uniqueness). */
const availableFlags = (field: FieldDefinition, draft: SchemaDefinition): FlagKey[] => {
  const isComponent = draft.kind === 'component';
  const modelLocalized = draft.kind !== 'component' && draft.localized;
  const indexable =
    !isComponent && SCALAR_DATA_TYPES.has(field.type) && !(field.type === 'enum' && field.settings.multiple);
  return [
    'required',
    ...(UNIQUE_CAPABLE_DATA_TYPES.has(field.type) && !isComponent ? (['unique'] as const) : []),
    ...(modelLocalized ? (['localized'] as const) : []),
    'public',
    ...(indexable ? (['filterable', 'sortable'] as const) : []),
    'deprecated',
  ];
};

/** A field's switches, two columns wide: each with its label and an info hint. */
export const Flags = ({ field, draft, at, disabled, onChange }: FlagsProps) => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-x-6 gap-y-4 @md/field-group:grid-cols-2">
      {availableFlags(field, draft).map((flag) => (
        <SwitchControl
          key={flag}
          id={`field-${field.id}-${flag}`}
          layout="compact"
          label={t(FLAG_KEYS[flag].label)}
          hint={t(FLAG_KEYS[flag].hint)}
          checked={field[flag]}
          onChange={(checked) => onChange({ [flag]: checked })}
          issues={at(flag)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};
