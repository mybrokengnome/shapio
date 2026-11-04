import { Marked } from 'marked';
import { sanitizePastedHtml } from '../richTextDocument';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/**
 * Markdown as the model writes it, to HTML for the proposal editor. Its own instance (never the shared
 * `marked` defaults): no GFM (no tables, no strikethrough), no soft breaks as `<br>`. Raw HTML in the answer
 * is shown as text, links keep only their text (no URLs nobody checked) and images are dropped. ProseMirror
 * then parses the result against the stored schema, which drops anything else.
 */
const markdown = new Marked({
  gfm: false,
  breaks: false,
  renderer: {
    html({ text, block }) {
      const escaped = escapeHtml(text);
      return block ? `<p>${escaped}</p>` : escaped;
    },
    link({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    image() {
      return '';
    },
  },
});

/**
 * HTML for a model's Markdown answer. Parsing it never runs anything: Tiptap reads it with `DOMParser`
 * (an inert document) and keeps only what the schema holds; scripts and styles are removed first anyway.
 */
export const markdownToHtml = (source: string): string =>
  sanitizePastedHtml(markdown.parse(source, { async: false }));
