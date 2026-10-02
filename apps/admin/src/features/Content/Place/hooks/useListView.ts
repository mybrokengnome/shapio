import { effectiveLayout, type ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import type { ListView } from '../constants';
import { useListColumnsStore } from '../stores/listColumns';

/**
 * Table or cards for this model, remembered per model in this browser. Cards need a cover field (the
 * document layout's cover); without one the list is always a table.
 */
export const useListView = (model: ModelDefinition) => {
  const cover = useMemo(() => effectiveLayout(model).cover, [model]);
  const stored = useListColumnsStore((state) => state.viewByModel[model.id]);
  const setStored = useListColumnsStore((state) => state.setView);
  const view: ListView = cover && stored === 'cards' ? 'cards' : 'table';
  return { view, cover, setView: (next: ListView) => setStored(model.id, next) };
};
