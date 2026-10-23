import {
  ANY_TARGET,
  SETTINGS_SCHEMAS,
  type FieldDefinition,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { issuesUnder } from '../../../helpers/issues';
import { targetTypeLabel } from '../../../helpers/relationTargetLabel';
import { describeProperties, type DescribedProperty } from '../../../helpers/schemaControls';
import { orderAsTree } from '../../../helpers/tree';
import { ChoicesControl } from '../../controls/ChoicesControl';
import { IssueList } from '../../controls/IssueList';
import { SelectControl } from '../../controls/SelectControl';
import { useDraftDefinitionIndex } from '../../hooks/useDraftDefinitionIndex';
import { PropertyControl } from '../../PropertyControl';
import { EnumValues } from '../EnumValues';

type TypeSettingsProps = {
  field: FieldDefinition;
  draft: SchemaDefinition;
  path: string;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
};

/** Settings managed elsewhere or not user-facing. */
const HIDDEN_SETTINGS: ReadonlySet<string> = new Set(['formatVersion']);

/** Settings a contract field can't have (plan interfaces decision 4): a slug's source is per member. */
const HIDDEN_CONTRACT_SETTINGS: ReadonlySet<string> = new Set(['sourceFieldId']);

/** Types whose bounds are text in a canonical format (ADR 0001); the hint shows the format. */
const FORMAT_HINT_KEYS = {
  date: 'models.formats.date',
  datetime: 'models.formats.datetime',
  time: 'models.formats.time',
  decimal: 'models.formats.decimal',
  biginteger: 'models.formats.biginteger',
} as const;

const SOURCE_FIELD_TYPES: ReadonlySet<string> = new Set(['string', 'text']);

/** `validate` on a code field only means something for JSON. */
const VALIDATING_LANGUAGE = 'json';

/**
 * The data type's settings, rendered from `SETTINGS_SCHEMAS[type]` (the schema the server validates), with
 * pickers for the settings that reference other definitions or fields.
 */
export const TypeSettings = ({ field, draft, path, issues, disabled, onChange }: TypeSettingsProps) => {
  const { t } = useTranslation();
  const { index, definitions: all } = useDraftDefinitionIndex(draft);
  const settings = field.settings as Record<string, unknown>;
  const settingsPath = `${path}/settings`;
  const idPrefix = `field-${field.id}-settings`;
  const byLabel = (a: SchemaDefinition, b: SchemaDefinition) => a.label.localeCompare(b.label);
  // A relation targets a collection (with its kinds), an interface (its members), or any entry.
  const collections = all.filter((entry) => entry.kind === 'collection').sort(byLabel);
  const interfaces = all.filter((entry) => entry.kind === 'interface' && entry.id !== draft.id).sort(byLabel);
  const components = all.filter((entry) => entry.kind === 'component' && entry.id !== draft.id);
  const toOption = (entry: SchemaDefinition) => ({ value: entry.id, label: entry.label });
  const targetGroups = [
    {
      label: t('models.builder.targetTypes'),
      // Each kind under the type it extends, once; roots and siblings stay alphabetical.
      options: orderAsTree(
        collections,
        (entry) => entry.id,
        (entry) => (entry.kind === 'collection' ? entry.extends : undefined),
      ).map(({ item, depth }) => ({ value: item.id, label: targetTypeLabel(item, index, t), depth })),
    },
    { label: t('models.builder.targetInterfaces'), options: interfaces.map(toOption) },
    {
      label: t('models.builder.targetAny'),
      options: [{ value: ANY_TARGET, label: t('models.builder.anyEntry') }],
    },
  ];
  const at = (key: string) => issuesUnder(issues, `${settingsPath}/${key}`);

  const render = (property: DescribedProperty) => {
    const { key } = property;
    const common = { id: `${idPrefix}-${key}`, issues: at(key), disabled };
    if (field.type === 'enum' && key === 'values') {
      return (
        <EnumValues
          key={key}
          idPrefix={common.id}
          field={field}
          path={`${settingsPath}/values`}
          issues={issues}
          disabled={disabled}
          onChange={(values) => onChange('values', values)}
        />
      );
    }
    if (key === 'target') {
      return (
        <SelectControl
          key={key}
          {...common}
          label={t('models.properties.target')}
          value={settings.target as string}
          groups={targetGroups}
          onChange={(value) => onChange('target', value ?? '')}
          placeholder={t('models.builder.chooseModel')}
        />
      );
    }
    if (key === 'component') {
      return (
        <SelectControl
          key={key}
          {...common}
          label={t('models.properties.component')}
          value={settings.component as string}
          options={components.map(toOption)}
          onChange={(value) => onChange('component', value ?? '')}
          placeholder={t('models.builder.chooseComponent')}
          {...(components.length === 0 ? { description: t('models.builder.noComponents') } : {})}
        />
      );
    }
    if (key === 'components') {
      return (
        <ChoicesControl
          key={key}
          {...common}
          label={t('models.properties.components')}
          value={(settings.components as string[] | undefined) ?? []}
          options={components.map(toOption)}
          onChange={(value) => onChange('components', value)}
          {...(components.length === 0 ? { description: t('models.builder.noComponents') } : {})}
        />
      );
    }
    if (key === 'sourceFieldId') {
      return (
        <SelectControl
          key={key}
          {...common}
          label={t('models.properties.sourceFieldId')}
          hint={t('models.builder.sourceFieldHint')}
          value={settings.sourceFieldId as string | undefined}
          options={draft.fields
            .filter((candidate) => candidate.id !== field.id && SOURCE_FIELD_TYPES.has(candidate.type))
            .map((candidate) => ({ value: candidate.id, label: candidate.label }))}
          onChange={(value) => onChange('sourceFieldId', value)}
          unsetLabel={t('models.notSet')}
        />
      );
    }
    if (field.type === 'code' && key === 'validate') {
      // Shown for JSON only, and while an invalid `validate` is still set, so it can be switched off.
      if (settings.language !== VALIDATING_LANGUAGE && settings.validate !== true) {
        return null;
      }
    }
    const formatKey =
      property.control.kind === 'text' && field.type in FORMAT_HINT_KEYS
        ? FORMAT_HINT_KEYS[field.type as keyof typeof FORMAT_HINT_KEYS]
        : undefined;
    return (
      <PropertyControl
        key={key}
        idPrefix={idPrefix}
        // A code field always has a language (it defaults to plain), so there is no "Not set" choice.
        property={field.type === 'code' && key === 'language' ? { ...property, required: true } : property}
        value={settings[key]}
        onChange={(value) => {
          onChange(key, value);
          if (field.type === 'code' && key === 'language' && value !== VALIDATING_LANGUAGE) {
            // No hidden setting left behind: `validate` needs JSON.
            onChange('validate', undefined);
          }
        }}
        issues={common.issues}
        disabled={disabled}
        description={formatKey === undefined ? undefined : t(formatKey)}
        hint={key === 'pattern' ? t('models.builder.patternHint') : undefined}
      />
    );
  };

  const properties = describeProperties(SETTINGS_SCHEMAS[field.type]).filter(
    (property) =>
      !HIDDEN_SETTINGS.has(property.key) &&
      !(draft.kind === 'interface' && HIDDEN_CONTRACT_SETTINGS.has(property.key)),
  );
  const rendered = new Set(properties.map((property) => property.key));
  const otherIssues = issuesUnder(issues, settingsPath).filter(
    (found) => !rendered.has(found.path.slice(settingsPath.length + 1).split('/')[0] ?? ''),
  );
  if (properties.length === 0) {
    return <p className="text-meta text-muted-foreground">{t('models.builder.noSettings')}</p>;
  }
  return (
    <>
      {properties.map(render)}
      <IssueList issues={otherIssues} />
    </>
  );
};
