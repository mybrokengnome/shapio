import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import type { FieldControlState } from '../hooks/useFieldControl';
import { EditorErrorBoundary } from '../runtime/EditorErrorBoundary';

type FieldEditorProps = { control: FieldControlState };

/**
 * The editor a field resolves to: a project's custom editor (falling back to the built-in if it throws) or
 * a built-in one (lazy ones show a skeleton while they load), plus the note when a custom editor is missing.
 */
export const FieldEditor = ({ control }: FieldEditorProps) => {
  const { t } = useTranslation();
  const { resolved, builtIn, builtInProps, contractProps } = control;
  const BuiltInComponent = builtIn.component;
  return (
    <>
      {resolved.kind === 'runtime' ? (
        <EditorErrorBoundary
          editorId={resolved.definition.id}
          fallback={<BuiltInComponent {...builtInProps} />}
        >
          <resolved.definition.component {...contractProps} />
        </EditorErrorBoundary>
      ) : (
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <BuiltInComponent {...builtInProps} />
        </Suspense>
      )}
      {resolved.kind === 'builtIn' && resolved.missingCustomId ? (
        <p className="text-meta text-muted-foreground">
          {t('content.fields.customEditorMissing', { id: resolved.missingCustomId })}
        </p>
      ) : null}
    </>
  );
};
