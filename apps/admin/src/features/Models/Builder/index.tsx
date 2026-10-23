import type { DefinitionCategory } from '@shapio/client';
import { useFreshDefinition } from '@/api/schema';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Editor } from './Editor';

type BuilderProps = { category: DefinitionCategory; id: string };

/**
 * The model (or component) builder: loads the definition, then edits a draft of it. The draft starts from
 * a fresh read, never from a cached copy another session or the schema API may have changed since.
 */
export const Builder = ({ category, id }: BuilderProps) => {
  const { data, error, refetch } = useFreshDefinition(category, id);
  if (data) {
    return <Editor key={id} category={category} id={id} detail={data} />;
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  return <LoadingState />;
};
