import { createContext, useContext } from 'react';

type DefinitionNameLookup = (id: string) => string | undefined;

const knowsNone: DefinitionNameLookup = () => undefined;

/**
 * Definition names by stable ID inside the builder (the Editor provides them from the definitions cache), so
 * a control's issues can name the interface a contract issue is about. Outside a builder nothing is known
 * and messages fall back to the validator's own text.
 */
export const DefinitionNamesContext = createContext<DefinitionNameLookup>(knowsNone);

export const useDefinitionNameLookup = (): DefinitionNameLookup => useContext(DefinitionNamesContext);
