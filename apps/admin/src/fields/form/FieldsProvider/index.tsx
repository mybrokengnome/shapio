import type { ReactNode } from 'react';
import { EntryFormStoreContext, FieldsEnvironmentContext, type FieldsEnvironment } from '../context';
import type { EntryFormStore } from '../store';

type FieldsProviderProps = { environment: FieldsEnvironment; store: EntryFormStore; children: ReactNode };

export const FieldsProvider = ({ environment, store, children }: FieldsProviderProps) => (
  <FieldsEnvironmentContext.Provider value={environment}>
    <EntryFormStoreContext.Provider value={store}>{children}</EntryFormStoreContext.Provider>
  </FieldsEnvironmentContext.Provider>
);
