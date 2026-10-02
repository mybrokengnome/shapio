import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { SiblingValuesContext, useEntryForm, useFieldsEnvironment } from '../context';

type EntrySiblingsProps = { children: ReactNode };

/** Gives slug fields their source field's value; only its consumers re-render as values change. */
export const EntrySiblings = ({ children }: EntrySiblingsProps) => {
  const { model } = useFieldsEnvironment();
  const values = useEntryForm((state) => state.values);
  const siblings = useMemo(() => ({ definition: model, values }), [model, values]);
  return <SiblingValuesContext.Provider value={siblings}>{children}</SiblingValuesContext.Provider>;
};
