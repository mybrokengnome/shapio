import type { EditorManifest } from '@shapio/client';
import { EDITOR_CONTRACT_VERSION, isEditorDefinition, type EditorDefinition } from '@shapio/editor-sdk';
import { apiBaseUrl } from '@/api/client';
import { logError } from '@/helpers/reportError';

/**
 * Loads the project's custom field editors (ADR 0009). Each manifest entry is an ES module served by the
 * API; it imports `react` and `@shapio/editor-sdk` as bare specifiers, which the admin's import map resolves
 * to the admin's own instances. Any export that is an editor definition registers that editor.
 */
export type EditorLoadProblem = {
  file: string;
  reason: 'importFailed' | 'noEditor' | 'contractVersion' | 'duplicateId';
  detail?: string;
};

export type RuntimeEditors = {
  editors: ReadonlyMap<string, EditorDefinition>;
  problems: readonly EditorLoadProblem[];
};

export const NO_RUNTIME_EDITORS: RuntimeEditors = { editors: new Map(), problems: [] };

/** The module's URL: manifest paths are relative to the server's base URL (`{BASE_PATH}/`). */
export const editorModuleUrl = (path: string, base: string = apiBaseUrl()) =>
  new URL(path.replace(/^\/+/, ''), base).href;

type ImportModule = (url: string) => Promise<Record<string, unknown>>;

const importModule: ImportModule = (url) =>
  import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;

export const loadRuntimeEditors = async (
  manifest: EditorManifest,
  load: ImportModule = importModule,
): Promise<RuntimeEditors> => {
  const editors = new Map<string, EditorDefinition>();
  const problems: EditorLoadProblem[] = [];
  for (const item of manifest.items) {
    let module: Record<string, unknown>;
    try {
      module = await load(editorModuleUrl(item.path));
    } catch (error) {
      logError(error, `loading custom editor ${item.file}`);
      problems.push({ file: item.file, reason: 'importFailed', detail: String(error) });
      continue;
    }
    const definitions = Object.values(module).filter(isEditorDefinition);
    if (definitions.length === 0) {
      problems.push({ file: item.file, reason: 'noEditor' });
    }
    for (const definition of definitions) {
      if (definition.contractVersion !== EDITOR_CONTRACT_VERSION) {
        problems.push({ file: item.file, reason: 'contractVersion', detail: definition.id });
      } else if (editors.has(definition.id)) {
        problems.push({ file: item.file, reason: 'duplicateId', detail: definition.id });
      } else {
        editors.set(definition.id, definition);
      }
    }
  }
  return { editors, problems };
};
