import { DATA_TYPES, type DataType as DataTypeName } from '@shapio/schema';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioTile } from '@/components/RadioTile';
import { RadioGroup } from '@/components/ui/radio-group';
import { DATA_TYPE_GROUPS, DATA_TYPE_ICONS } from '../../../constants';

type DataTypeProps = {
  /** The section heading that names the radio group. */
  labelledBy: string;
  value: DataTypeName;
  /** Types shown but not selectable (a saved field can only take the types Shapio can convert it to). */
  unavailable: ReadonlySet<DataTypeName>;
  unavailableReason: (type: DataTypeName) => string;
  /** What saving the chosen type does, one short sentence each. */
  notes: readonly string[];
  /** Why some types aren't offered. */
  limitedNote?: string;
  disabled: boolean;
  onChange: (type: DataTypeName) => void;
};

const TYPES = DATA_TYPE_GROUPS.flatMap((group) => group.types);

const isDataType = (value: string): value is DataTypeName =>
  (DATA_TYPES as readonly string[]).includes(value);

/**
 * Every data type as an icon tile, in group order (text, numbers, choices, dates, structure), six to a row
 * where the panel is wide enough, then the selected type in one line and what changing a saved field's
 * type does. A radio group: Tab enters at the selected type, arrow keys choose another.
 */
export const DataType = ({
  labelledBy,
  value,
  unavailable,
  unavailableReason,
  notes,
  limitedNote,
  disabled,
  onChange,
}: DataTypeProps) => {
  const { t } = useTranslation();
  const descriptionId = useId();
  return (
    <div className="@container space-y-3">
      <RadioGroup
        value={value}
        disabled={disabled}
        onValueChange={(next) => isDataType(next) && onChange(next)}
        aria-labelledby={labelledBy}
        aria-describedby={descriptionId}
        className="grid-cols-4 gap-2 @xl:grid-cols-6"
      >
        {TYPES.map((type) => (
          <RadioTile
            key={type}
            value={type}
            variant="tile"
            icon={DATA_TYPE_ICONS[type]}
            label={t(`models.dataTypes.${type}.name`)}
            disabled={unavailable.has(type)}
            description={
              unavailable.has(type) ? unavailableReason(type) : t(`models.dataTypes.${type}.description`)
            }
          />
        ))}
      </RadioGroup>
      <p id={descriptionId} className="text-meta text-muted-foreground">
        <span className="font-semibold text-foreground">{t(`models.dataTypes.${value}.name`)}</span>
        {' · '}
        {t(`models.dataTypes.${value}.description`)}
      </p>
      {notes.length > 0 ? (
        <p role="status" className="text-meta font-medium text-warning">
          {notes.join(' ')}
        </p>
      ) : null}
      {limitedNote ? <p className="text-meta text-muted-foreground">{limitedNote}</p> : null}
    </div>
  );
};
