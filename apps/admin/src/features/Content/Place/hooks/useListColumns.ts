import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { columnChoicesFor, columnsFor } from '../columns';
import { useListColumnsStore } from '../stores/listColumns';

/**
 * The list's field columns (the person's choice, else the model's defaults), the fields that can be
 * chosen, and the setters. Field IDs, not API keys, so a renamed field stays chosen.
 */
export const useListColumns = (model: ModelDefinition) => {
  const chosenIds = useListColumnsStore((state) => state.byModel[model.id]);
  const setColumns = useListColumnsStore((state) => state.setColumns);
  const choices = useMemo(() => columnChoicesFor(model), [model]);
  const columns = useMemo<FieldDefinition[]>(() => {
    const chosen = chosenIds ? choices.filter((field) => chosenIds.includes(field.id)) : [];
    return chosen.length > 0 ? chosen : columnsFor(model);
  }, [chosenIds, choices, model]);
  const setColumnVisible = (fieldId: string, visible: boolean) => {
    const current = columns.map((field) => field.id);
    const next = visible ? [...current, fieldId] : current.filter((id) => id !== fieldId);
    setColumns(model.id, next.length > 0 ? next : undefined);
  };
  return {
    columns,
    columnChoices: choices,
    customized: chosenIds !== undefined,
    setColumnVisible,
    resetColumns: () => setColumns(model.id, undefined),
  };
};
