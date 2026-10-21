import { DATA_TYPES, type DataType as DataTypeName } from '@shapio/schema';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioTile } from '@/components/RadioTile';
import { RadioGroup } from '@/components/ui/radio-group';
import { cn } from '@/helpers/cn';
import { DATA_TYPE_GROUPS, DATA_TYPE_ICONS } from '../../../constants';

type DataTypeProps = {
  /** The section heading that names the radio group. */
  labelledBy: string;
  value: DataTypeName;
  /** What saving the chosen type does, one short sentence each. */
  notes: readonly string[];
  /** Saving drops every stored value (Shapio can't convert the saved type): the notes read as a danger. */
  dropsValues: boolean;
  /** Types not offered here (an interface's contract can't hold components). */
  excluded?: ReadonlySet<DataTypeName>;
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
  notes,
  dropsValues,
  excluded,
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
        {TYPES.filter((type) => type === value || !excluded?.has(type)).map((type) => (
          <RadioTile
            key={type}
            value={type}
            variant="tile"
            icon={DATA_TYPE_ICONS[type]}
            label={t(`models.dataTypes.${type}.name`)}
            description={t(`models.dataTypes.${type}.description`)}
          />
        ))}
      </RadioGroup>
      <p id={descriptionId} className="text-meta text-muted-foreground">
        <span className="font-semibold text-foreground">{t(`models.dataTypes.${value}.name`)}</span>
        {' · '}
        {t(`models.dataTypes.${value}.description`)}
      </p>
      {notes.length > 0 ? (
        <p
          role="status"
          className={cn('text-meta font-medium', dropsValues ? 'text-destructive' : 'text-warning')}
        >
          {notes.join(' ')}
        </p>
      ) : null}
    </div>
  );
};
