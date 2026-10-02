import { useParams } from '@tanstack/react-router';
import { Builder as DefinitionBuilder } from '@/features/Models/Builder';

/** `/develop/components/:componentId`: a component in the shared definition builder. */
export const Builder = () => {
  const { componentId } = useParams({ from: '/app/develop/components/$componentId' });
  return <DefinitionBuilder category="component" id={componentId} />;
};
