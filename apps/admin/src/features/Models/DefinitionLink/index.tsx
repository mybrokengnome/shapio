import type { SchemaDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { RowTitle } from '@/components/RowTitle';

type DefinitionLinkProps = { definition: Pick<SchemaDefinition, 'id' | 'kind' | 'label'> };

/** A definition's name as a list row title, linking to its builder (models and components differ). */
export const DefinitionLink = ({ definition }: DefinitionLinkProps) => (
  <RowTitle asChild>
    {definition.kind === 'component' ? (
      <Link to="/models/components/$componentId" params={{ componentId: definition.id }}>
        {definition.label}
      </Link>
    ) : (
      <Link to="/models/$modelId" params={{ modelId: definition.id }}>
        {definition.label}
      </Link>
    )}
  </RowTitle>
);
