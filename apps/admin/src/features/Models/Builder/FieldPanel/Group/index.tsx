import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newStableId } from '@/helpers/stableId';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { groupIdOf, withFieldInGroup, withFieldInNewGroup } from '../../../helpers/groups';
import { SelectControl } from '../../controls/SelectControl';
import { NewGroup } from './NewGroup';

type GroupProps = { model: ModelDefinition; field: FieldDefinition; disabled: boolean };

/** The select's "New group…" choice; never a group ID, which the builder generates as a UUID. */
const NEW_GROUP = '__new_group__';

/**
 * "Group": the `display.groups` entry the field is in (a section of the form). Choosing "New group…" asks for
 * a name inline and adds a group holding the field; a group the field leaves empty is dropped.
 */
export const Group = ({ model, field, disabled }: GroupProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const [creating, setCreating] = useState(false);
  const id = `field-${field.id}-group`;
  const apply = (change: (current: ModelDefinition) => ModelDefinition) =>
    update((current) => (current.kind === 'component' ? current : change(current)));
  const options = [
    ...(model.display.groups ?? []).map((group) => ({ value: group.id, label: group.label })),
    { value: NEW_GROUP, label: t('models.builder.groupNew') },
  ];
  return (
    <div className="space-y-3">
      <SelectControl
        id={id}
        label={t('models.builder.group')}
        hint={t('models.builder.groupHint')}
        value={creating ? NEW_GROUP : groupIdOf(model, field.id)}
        options={options}
        unsetLabel={t('models.builder.groupNone')}
        disabled={disabled}
        onChange={(value) => {
          setCreating(value === NEW_GROUP);
          if (value !== NEW_GROUP) {
            apply((current) => withFieldInGroup(current, field.id, value));
          }
        }}
      />
      {creating ? (
        <NewGroup
          id={`${id}-new`}
          disabled={disabled}
          onCancel={() => setCreating(false)}
          onCreate={(label) => {
            apply((current) => withFieldInNewGroup(current, field.id, { id: newStableId(), label }));
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
};
