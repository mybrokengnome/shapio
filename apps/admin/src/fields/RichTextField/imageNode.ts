import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaImage: {
      /** Inserts an image from the media library. */
      insertMediaImage: (attributes: { mediaId: string; alt?: string | null }) => ReturnType;
    };
  }
}

const STABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `image`: a media library reference plus alt text, never a URL (ADR 0003), so private media stays private
 * and delivery resolves the URL. Only images carrying a valid `data-media-id` survive a paste. The editor
 * adds its React node view (`ImageView`) on top; the schema alone is shared with tests.
 */
export const MediaImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: { default: null, parseHTML: (element) => element.getAttribute('data-media-id') },
      alt: { default: null, parseHTML: (element) => element.getAttribute('alt') || null },
      title: { default: null, parseHTML: (element) => element.getAttribute('title') || null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-media-id]',
        getAttrs: (element) => (STABLE_ID.test(element.getAttribute('data-media-id') ?? '') ? null : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(
        { 'data-media-id': node.attrs.mediaId as string },
        { alt: HTMLAttributes.alt as string | null, title: HTMLAttributes.title as string | null },
      ),
    ];
  },

  addCommands() {
    return {
      insertMediaImage:
        ({ mediaId, alt = null }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { mediaId, alt: alt || null, title: null } }),
    };
  },
});
