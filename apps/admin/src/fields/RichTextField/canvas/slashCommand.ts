import { Extension, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { exitSuggestion, Suggestion } from '@tiptap/suggestion';
import { createRelay } from '../../helpers/relay';

/** What the `/` menu shows: the text typed after the slash, the range to replace, and where to anchor. */
export type SlashState = { query: string; range: Range; rect: () => DOMRect | null };

/**
 * The React side of the `/` menu, kept by the editor for its lifetime: the menu component sets fresh
 * handlers after every render, so the plugin never calls stale closures.
 */
export const createSlashBridge = () => ({
  onChange: createRelay<[SlashState | null], void>(() => undefined),
  /** Arrow keys, Enter and Tab while the menu is open; true when handled. */
  onKeyDown: createRelay<[KeyboardEvent], boolean>(() => false),
});

export type SlashBridge = ReturnType<typeof createSlashBridge>;

const slashPluginKey = new PluginKey('slashCommand');

/** Closes the `/` menu without choosing (a click outside it). */
export const closeSlashMenu = (view: EditorView) => exitSuggestion(view, slashPluginKey);

const NO_RECT = () => null;

/**
 * `/` opens the block menu where the cursor is (at the start of a line or after a space, not in code). The
 * menu filters as you type; choosing turns the current block into the chosen one (`turnInto`).
 */
export const SlashCommand = Extension.create<{ bridge: SlashBridge }>({
  name: 'slashCommand',
  addOptions() {
    return { bridge: createSlashBridge() };
  },
  addProseMirrorPlugins() {
    const { bridge } = this.options;
    const emit = (props: { query: string; range: Range; clientRect?: (() => DOMRect | null) | null }) =>
      bridge.onChange.call({ query: props.query, range: props.range, rect: props.clientRect ?? NO_RECT });
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: '/',
        dismissOnOutsideClick: false,
        allow: ({ state, range }) => {
          const parent = state.doc.resolve(range.from).parent;
          return !parent.type.spec.code;
        },
        items: () => [],
        command: () => undefined,
        render: () => ({
          onStart: emit,
          onUpdate: emit,
          onKeyDown: ({ event }) => {
            if (event.key === 'Escape') {
              bridge.onChange.call(null);
              return true;
            }
            return bridge.onKeyDown.call(event);
          },
          onExit: () => bridge.onChange.call(null),
        }),
      }),
    ];
  },
});
