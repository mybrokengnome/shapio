import { useParams } from '@tanstack/react-router';
import { Builder as DefinitionBuilder } from '@/features/Models/Builder';

/** `/develop/interfaces/:interfaceId`: an interface in the shared definition builder. */
export const Builder = () => {
  const { interfaceId } = useParams({ from: '/app/develop/interfaces/$interfaceId' });
  return <DefinitionBuilder category="interface" id={interfaceId} />;
};
