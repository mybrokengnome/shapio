import type { SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '@/components/CodeBlock';
import { graphqlSdl, type DefinitionLookup } from '../../helpers/shapes';

type GraphqlShapeProps = { definition: SchemaDefinition; lookup: DefinitionLookup };

/** The definition's GraphQL type and root fields, as SDL. */
export const GraphqlShape = ({ definition, lookup }: GraphqlShapeProps) => {
  const { t } = useTranslation();
  const sdl = useMemo(() => graphqlSdl(definition, lookup), [definition, lookup]);
  return <CodeBlock label={t('develop.schema.preview.sdl')} code={sdl} />;
};
