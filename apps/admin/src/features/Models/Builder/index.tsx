import type { DefinitionCategory } from '@shapio/client';
import { useDefinition } from '@/api/schema';
import { QueryView } from '@/components/QueryView';
import { Editor } from './Editor';

type BuilderProps = { category: DefinitionCategory; id: string };

/** The model (or component) builder: loads the definition, then edits a draft of it. */
export const Builder = ({ category, id }: BuilderProps) => {
  const detail = useDefinition(category, id);
  return (
    <QueryView query={detail}>
      {(data) => <Editor key={id} category={category} id={id} detail={data} />}
    </QueryView>
  );
};
