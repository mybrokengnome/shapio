import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type PlaceholderAction = { add: { id: string; pos: number } } | { remove: { id: string } };

const specId = (spec: unknown) => (spec as { id?: string } | undefined)?.id;

export const uploadPlaceholderKey = new PluginKey<DecorationSet>('uploadPlaceholder');

/** The placeholder's look: a muted band with a spinner, built from DOM (a widget, never in the document). */
const placeholderDom = (label: string) => {
  const element = document.createElement('div');
  element.className =
    'my-4 flex h-40 items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 font-sans text-sm text-muted-foreground';
  element.setAttribute('role', 'status');
  element.setAttribute('data-upload-placeholder', '');
  const spinner = document.createElement('span');
  spinner.className =
    'size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label;
  element.append(spinner, text);
  return element;
};

/**
 * Where a dropped or pasted image will appear while it uploads: a widget decoration that follows edits
 * around it and is never serialized (the stored document only ever holds finished image nodes).
 */
export const UploadPlaceholder = Extension.create<{ label: (name: string) => string }>({
  name: 'uploadPlaceholder',
  addOptions() {
    return { label: (name: string) => name };
  },
  addProseMirrorPlugins() {
    const { label } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: uploadPlaceholderKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, previous) => {
            let set = previous.map(tr.mapping, tr.doc);
            const action = tr.getMeta(uploadPlaceholderKey) as
              (PlaceholderAction & { name?: string }) | undefined;
            if (action && 'add' in action) {
              const widget = Decoration.widget(
                action.add.pos,
                () => placeholderDom(label(action.name ?? '')),
                {
                  id: action.add.id,
                  side: -1,
                },
              );
              set = set.add(tr.doc, [widget]);
            } else if (action && 'remove' in action) {
              set = set.remove(set.find(undefined, undefined, (spec) => specId(spec) === action.remove.id));
            }
            return set;
          },
        },
        props: {
          decorations: (state) => uploadPlaceholderKey.getState(state),
        },
      }),
    ];
  },
});

export const addUploadPlaceholder = (tr: Transaction, id: string, pos: number, name: string) =>
  tr.setMeta(uploadPlaceholderKey, { add: { id, pos }, name });

export const removeUploadPlaceholder = (tr: Transaction, id: string) =>
  tr.setMeta(uploadPlaceholderKey, { remove: { id } });

/** Where a placeholder is now (edits around it moved it), or undefined once removed. */
export const findUploadPlaceholder = (state: EditorState, id: string): number | undefined =>
  uploadPlaceholderKey.getState(state)?.find(undefined, undefined, (spec) => specId(spec) === id)[0]?.from;
