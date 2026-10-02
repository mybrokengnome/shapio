import type { FieldEditorProps } from '@shapio/editor-sdk';
import type { FieldDefinition } from '@shapio/schema';
import type { ComponentType } from 'react';

/**
 * Built-in editors get the public editor contract (`@shapio/editor-sdk`) plus what only first-party
 * editors need: the full field definition and the value's JSON-pointer path (nested fields and their
 * issues hang off it).
 */
export type BuiltInEditorProps = Omit<FieldEditorProps, 'value' | 'onChange'> & {
  /** The current value (null when empty). Built-ins check its shape rather than trust it. */
  value: unknown;
  onChange: (value: unknown) => void;
  definition: FieldDefinition;
  path: string;
  /**
   * `form` (default): a labelled control in a form, the settings drawer or the property grid.
   * `canvas`: a block of the entry document's writing surface (borderless, no field chrome of its own).
   * Built-ins only: custom editors keep the public contract and render inside `CanvasBlock`.
   */
  appearance?: EditorAppearance;
};

export type EditorAppearance = 'form' | 'canvas';

export type BuiltInEditor = {
  component: ComponentType<BuiltInEditorProps>;
  /**
   * `input`: one focusable control that the field's `<label for>` points at.
   * `group`: several controls (radio buttons, items) labelled with `aria-labelledby`.
   */
  labelling: 'input' | 'group';
};
