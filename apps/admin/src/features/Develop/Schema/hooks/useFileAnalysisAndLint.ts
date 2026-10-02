import type { SchemaDefinition, ValidationIssue } from '@shapio/schema';
import { useCallback, useMemo } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { analyzeFile, issuesOf, type AnalyzeContext, type FileAnalysis } from '../helpers/analyze';
import type { SchemaFile } from '../helpers/files';

/** How long typing pauses before the preview pane re-renders the definition. */
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The open file's meaning for the preview pane (debounced while typing) and the editor's semantic lint
 * function. Cross-definition checks run against the other files as loaded.
 */
export const useFileAnalysisAndLint = (
  file: SchemaFile | undefined,
  text: string,
  definitions: readonly SchemaDefinition[],
) => {
  const context = useMemo<AnalyzeContext | undefined>(
    () =>
      file
        ? {
            previous: file.base.definition,
            others: definitions.filter((definition) => definition.id !== file.definitionId),
          }
        : undefined,
    [file, definitions],
  );
  const debouncedText = useDebouncedValue(text, PREVIEW_DEBOUNCE_MS);
  const analysis = useMemo<FileAnalysis | undefined>(
    () => (context ? analyzeFile(debouncedText, context) : undefined),
    [context, debouncedText],
  );
  const lint = useCallback(
    (current: string): readonly ValidationIssue[] => (context ? issuesOf(analyzeFile(current, context)) : []),
    [context],
  );
  return { analysis, lint };
};
