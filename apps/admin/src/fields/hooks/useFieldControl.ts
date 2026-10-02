import type { FieldEditorProps } from '@shapio/editor-sdk';
import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { useCallback, useMemo } from 'react';
import { useEntryForm, useFieldsEnvironment } from '../form/context';
import { clientIssuesOf } from '../helpers/clientValidation';
import { fieldDomId } from '../helpers/domIds';
import { toEditorContext, toEditorField, toEditorModel } from '../helpers/editorContext';
import { describeIssue } from '../helpers/issues';
import { resolveEditor } from '../registry';
import type { BuiltInEditorProps, EditorAppearance } from '../types';

export type FieldControlOptions = {
  field: FieldDefinition;
  /** The model or component the field belongs to. */
  owner: SchemaDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  /** JSON pointer of the value, e.g. `/hero/title` (issues use the same paths). */
  path: string;
  appearance?: EditorAppearance;
};

/** Component and dynamic-zone editors render nested fields, which show their own issues. */
const NESTING_TYPES: ReadonlySet<string> = new Set(['component', 'dynamiczone']);

const useFieldMessages = (field: FieldDefinition, value: unknown, path: string): string[] => {
  const serverIssues = useEntryForm((state) => state.issues);
  const revealed = useEntryForm((state) => state.revealAll || state.touched.has(path));
  return useMemo(() => {
    const nesting = NESTING_TYPES.has(field.type);
    const server = serverIssues.filter(
      (issue) =>
        issue.path === path ||
        (issue.path.startsWith(`${path}/`) && (!nesting || issue.path === `${path}/__component`)),
    );
    const client = revealed
      ? clientIssuesOf(field, value).filter((issue) => !server.some((known) => known.code === issue.code))
      : [];
    return [...new Set([...server, ...client].map((issue) => describeIssue(issue, field)))];
  }, [field, value, path, serverIssues, revealed]);
};

/**
 * Everything a field's chrome needs, whatever it looks like (a labelled form row, a canvas block, a
 * property chip): which editor renders it (a project's custom editor or a built-in), the props for it, the
 * DOM ids that tie label, description and errors together, and the messages to show (server issues for this
 * path, plus client-side checks once the field was left or a save was attempted).
 */
export const useFieldControl = ({
  field,
  owner,
  value,
  onChange,
  path,
  appearance = 'form',
}: FieldControlOptions) => {
  const environment = useFieldsEnvironment();
  const touch = useEntryForm((state) => state.touch);
  const messages = useFieldMessages(field, value, path);
  const onBlur = useCallback(() => touch(path), [touch, path]);
  const resolved = useMemo(
    () => resolveEditor(field, environment.runtimeEditors),
    [field, environment.runtimeEditors],
  );
  const inputId = fieldDomId(environment.idPrefix, path);
  const labelId = `${inputId}-label`;
  const descriptionId = field.description ? `${inputId}-description` : undefined;
  const errorsId = messages.length > 0 ? `${inputId}-errors` : undefined;
  const describedBy = [descriptionId, errorsId].filter(Boolean).join(' ') || undefined;
  const editorField = useMemo(() => toEditorField(field), [field]);
  const editorModel = useMemo(() => toEditorModel(owner), [owner]);
  const context = useMemo(() => toEditorContext(environment), [environment]);
  const builtInProps: BuiltInEditorProps = {
    inputId,
    labelId,
    describedBy,
    value: value ?? null,
    onChange,
    onBlur,
    validation: { errors: messages, invalid: messages.length > 0 },
    readOnly: environment.readOnly,
    disabled: environment.disabled,
    field: editorField,
    model: editorModel,
    context,
    definition: field,
    path,
    appearance,
  };
  // Custom editors get exactly the public contract: no definition internals, no form paths, no appearance.
  const { definition: _definition, path: _path, appearance: _appearance, ...contractProps } = builtInProps;
  const builtIn = resolved.kind === 'builtIn' ? resolved.editor : resolved.fallback;
  return {
    resolved,
    builtIn,
    builtInProps,
    contractProps: contractProps as FieldEditorProps,
    /** How the label points at the editor: `<label for>` (one input) or `aria-labelledby` (a group). */
    labelling: resolved.kind === 'runtime' ? ('input' as const) : builtIn.labelling,
    inputId,
    labelId,
    descriptionId,
    errorsId,
    messages,
  };
};

export type FieldControlState = ReturnType<typeof useFieldControl>;
