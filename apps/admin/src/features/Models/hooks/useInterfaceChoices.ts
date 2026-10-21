import type { DefinitionScope } from '@shapio/client';
import type { InterfaceDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useDefinitions } from '@/api/schema';
import { interfacesInScope } from '../helpers/interfaces';

/**
 * The interfaces a type in the given scope may implement (see `interfacesInScope`): shared ones, and the
 * site's own for a type on that site. Empty while they load.
 */
export const useInterfaceChoices = (placement: {
  scope: DefinitionScope;
  siteId: string | null;
}): { interfaceChoices: InterfaceDefinition[] } => {
  const { data } = useDefinitions('interface');
  const { scope, siteId } = placement;
  const interfaceChoices = useMemo(
    () => interfacesInScope(data ?? [], { scope, siteId }),
    [data, scope, siteId],
  );
  return { interfaceChoices };
};
