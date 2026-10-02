import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '../CodeEditor';
import { editorSchemaFor } from '../CodeEditor/helpers/editorSchema';
import { issuesOf } from '../helpers/analyze';
import type { SchemaFile } from '../helpers/files';
import { useFileAnalysisAndLint } from '../hooks/useFileAnalysisAndLint';
import type { SchemaWorkspace } from '../hooks/useSchemaWorkspace';
import { IssueList } from '../IssueList';
import { Preview } from '../Preview';

type WorkbenchProps = { file: SchemaFile; workspace: SchemaWorkspace };

/** One open schema file: the editor (with its problems listed below it) and the preview pane. */
export const Workbench = ({ file, workspace }: WorkbenchProps) => {
  const { t } = useTranslation();
  const issuesId = useId();
  const { setText, textOf, isDirty, definitions } = workspace;
  const text = textOf(file);
  const edited = isDirty(file);
  const { analysis, lint } = useFileAnalysisAndLint(file, text, definitions);
  const onChange = useCallback((next: string) => setText(file, next), [setText, file]);
  const issues = analysis ? issuesOf(analysis) : [];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel
        title={file.path.slice(file.path.lastIndexOf('/') + 1)}
        description={file.path}
        flush
        actions={
          edited ? (
            <>
              <StatusChip tone="warning" label={t('develop.schema.modified')} size="sm" />
              <InlineConfirm
                tone="danger"
                title={t('develop.schema.revertTitle')}
                description={t('develop.schema.revertDescription')}
                confirmLabel={t('develop.schema.revert')}
                onConfirm={() => setText(file, file.base.text)}
                trigger={
                  <Button type="button" size="sm" variant="ghost">
                    {t('develop.schema.revert')}
                  </Button>
                }
              />
            </>
          ) : null
        }
      >
        <CodeEditor
          className="h-[28rem] rounded-none border-0 xl:h-[40rem]"
          value={text}
          onChange={onChange}
          label={t('develop.schema.editorLabel', { path: file.path })}
          describedBy={issuesId}
          readOnly={false}
          schema={editorSchemaFor(file.category)}
          lint={lint}
        />
        {analysis?.status === 'invalidJson' ? (
          <p role="status" className="border-t px-5 py-3 text-meta text-destructive">
            {t('develop.schema.invalidJson', { message: analysis.message })}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <div className="border-t p-4">
            <IssueList id={issuesId} issues={issues} />
          </div>
        ) : null}
      </Panel>
      <Preview file={file} analysis={analysis} edited={edited} definitions={definitions} />
    </div>
  );
};
