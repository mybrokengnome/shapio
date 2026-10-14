import type { EditorDefinition } from '@shapio/editor-sdk';
import {
  DEFAULT_EDITORS,
  EDITOR_CATALOG,
  isCustomEditorId,
  SEO_EDITOR_ID,
  type FieldDefinition,
} from '@shapio/schema';
import { lazy } from 'react';
import { CheckboxGroup } from './CheckboxGroup';
import { CheckboxInput } from './CheckboxInput';
import { ColorInput } from './ColorInput';
import { ComponentField } from './ComponentField';
import { DateInput } from './DateInput';
import { DateTimeInput } from './DateTimeInput';
import { DynamicZoneField } from './DynamicZoneField';
import { JsonEditor } from './JsonEditor';
import { MediaField } from './MediaField';
import { NumberInput } from './NumberInput';
import { RadioInput } from './RadioInput';
import { RelationField } from './RelationField';
import { Segmented } from './Segmented';
import { SelectInput } from './SelectInput';
import { SeoField } from './SeoField';
import { SlugInput } from './SlugInput';
import { Textarea } from './Textarea';
import { TextInput } from './TextInput';
import { TimeInput } from './TimeInput';
import { Toggle } from './Toggle';
import type { BuiltInEditor } from './types';

/** Tiptap and ProseMirror are most of the editor code: loaded only when a form has a rich-text field. */
const RichTextField = lazy(() =>
  import('./RichTextField').then((module) => ({ default: module.RichTextField })),
);

/** CodeMirror and its language packs: loaded only when a form has a code field. */
const CodeEditor = lazy(() => import('./CodeEditor').then((module) => ({ default: module.CodeEditor })));

/** Built-in editors by catalog ID (`EDITOR_CATALOG` in @shapio/schema). */
export const BUILT_IN_EDITORS: Readonly<Record<string, BuiltInEditor>> = {
  textInput: { component: TextInput, labeling: 'input' },
  textarea: { component: Textarea, labeling: 'input' },
  color: { component: ColorInput, labeling: 'input' },
  richText: { component: RichTextField, labeling: 'group' },
  numberInput: { component: NumberInput, labeling: 'input' },
  toggle: { component: Toggle, labeling: 'input' },
  checkbox: { component: CheckboxInput, labeling: 'input' },
  segmented: { component: Segmented, labeling: 'group' },
  select: { component: SelectInput, labeling: 'input' },
  radio: { component: RadioInput, labeling: 'group' },
  checkboxGroup: { component: CheckboxGroup, labeling: 'group' },
  datePicker: { component: DateInput, labeling: 'input' },
  dateTimePicker: { component: DateTimeInput, labeling: 'input' },
  timePicker: { component: TimeInput, labeling: 'input' },
  slugInput: { component: SlugInput, labeling: 'input' },
  jsonEditor: { component: JsonEditor, labeling: 'input' },
  codeEditor: { component: CodeEditor, labeling: 'group' },
  mediaPicker: { component: MediaField, labeling: 'group' },
  relationPicker: { component: RelationField, labeling: 'group' },
  componentEditor: { component: ComponentField, labeling: 'group' },
  dynamicZoneEditor: { component: DynamicZoneField, labeling: 'group' },
  [SEO_EDITOR_ID]: { component: SeoField, labeling: 'group' },
};

/** The built-in editor for a field: its chosen one when compatible, otherwise its data type's default. */
export const builtInEditorFor = (field: FieldDefinition): BuiltInEditor => {
  const chosen = BUILT_IN_EDITORS[field.editor.id];
  const compatible = EDITOR_CATALOG.get(field.editor.id)?.dataTypes.includes(field.type) ?? false;
  const fallback = BUILT_IN_EDITORS[DEFAULT_EDITORS[field.type]];
  if (!fallback) {
    throw new Error(`No built-in editor for data type ${field.type}`);
  }
  return chosen && compatible ? chosen : fallback;
};

export type ResolvedEditor =
  | { kind: 'builtIn'; editor: BuiltInEditor; missingCustomId: string | undefined }
  | { kind: 'runtime'; definition: EditorDefinition; fallback: BuiltInEditor };

/** Which editor renders a field: a project's custom editor when installed and compatible, else a built-in. */
export const resolveEditor = (
  field: FieldDefinition,
  runtimeEditors: ReadonlyMap<string, EditorDefinition>,
): ResolvedEditor => {
  const builtIn = builtInEditorFor(field);
  if (!isCustomEditorId(field.editor.id)) {
    return { kind: 'builtIn', editor: builtIn, missingCustomId: undefined };
  }
  const custom = runtimeEditors.get(field.editor.id);
  if (custom && (custom.dataTypes as readonly string[]).includes(field.type)) {
    return { kind: 'runtime', definition: custom, fallback: builtIn };
  }
  return { kind: 'builtIn', editor: builtIn, missingCustomId: field.editor.id };
};
