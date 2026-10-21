import type { InterfaceDefinition, ModelDefinition, ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { membershipsOf } from '../../../helpers/interfaces';
import { useModelIndex } from '../../../hooks/useModelIndex';
import { ChoicesControl } from '../../controls/ChoicesControl';

type ImplementsProps = {
  model: ModelDefinition;
  /** The interfaces in the type's scope (shared ones, and its site's own). */
  choices: readonly InterfaceDefinition[];
  issues: readonly ValidationIssue[];
  disabled: boolean;
};

/**
 * "Implements" (plan interfaces D11): the interfaces the type is a member of. Those it gets from the type it
 * extends are listed checked and locked, "via Products"; an interface it names that is no longer offered
 * (another scope) stays listed so it can be removed.
 */
export const Implements = ({ model, choices, issues, disabled }: ImplementsProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const { index } = useModelIndex();
  const own = model.implements ?? [];
  const memberships = membershipsOf(index, model.id, own);
  const inherited = memberships.filter((entry) => entry.via !== undefined);
  const inheritedIds = new Set(inherited.map((entry) => entry.interfaceId));
  const nameOf = (id: string) =>
    choices.find((choice) => choice.id === id)?.label ?? index.get(id)?.label ?? id;
  const options = [
    ...inherited.map(({ interfaceId, via }) => ({
      value: interfaceId,
      label: t('models.implements.via', {
        name: nameOf(interfaceId),
        model: index.get(via ?? '')?.label ?? '',
      }),
    })),
    ...own
      .filter((id) => !inheritedIds.has(id) && !choices.some((choice) => choice.id === id))
      .map((id) => ({ value: id, label: nameOf(id) })),
    ...choices
      .filter((choice) => !inheritedIds.has(choice.id))
      .map((choice) => ({ value: choice.id, label: choice.label })),
  ];
  if (options.length === 0) {
    return null;
  }
  const setImplements = (ids: readonly string[]) =>
    update((current) => {
      if (current.kind !== 'collection' && current.kind !== 'singleton') {
        return current;
      }
      const { implements: _previous, ...rest } = current;
      const next = ids.filter((id) => !inheritedIds.has(id));
      return next.length === 0 ? rest : { ...rest, implements: [...next].sort() };
    });
  return (
    <ChoicesControl
      id="definition-implements"
      label={t('models.implements.label')}
      hint={t('models.implements.hint')}
      value={[...inherited.map((entry) => entry.interfaceId), ...own]}
      options={options}
      locked={[...inheritedIds]}
      onChange={setImplements}
      issues={issues}
      disabled={disabled}
    />
  );
};
