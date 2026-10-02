import { lazy, Suspense } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { cn } from '@/helpers/cn';
import type { CodeMirrorViewProps } from './View';

/** CodeMirror and its JSON-schema support load only when the Schema screen opens an editor. */
const View = lazy(() => import('./View').then((module) => ({ default: module.View })));

type CodeEditorProps = CodeMirrorViewProps & { className?: string };

/** A JSON code editor with completion, hover and lint, framed like an input (focus ring on the frame). */
export const CodeEditor = ({ className, ...props }: CodeEditorProps) => (
  <div
    className={cn(
      'min-h-0 overflow-hidden rounded-xl border bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
      className,
    )}
  >
    <Suspense fallback={<LoadingState rows={8} className="p-4" />}>
      <View {...props} />
    </Suspense>
  </div>
);
