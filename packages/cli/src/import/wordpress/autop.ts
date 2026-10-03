/**
 * A reduced port of WordPress's `wpautop`: classic-editor content (and Markdown-free plain posts) is stored
 * without paragraph tags, and WordPress adds them when it renders. Blank lines become paragraphs and single
 * newlines `<br>`, outside block elements and `<pre>`. Block-editor content (`<!-- wp:` comments) already has
 * its markup and is returned as it is.
 */
const BLOCK_TAGS =
  'table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary|iframe|script|video|audio|object';
/** Blocks whose own content can hold paragraphs (WordPress wraps text inside these too). */
const CONTAINER_TAGS = 'blockquote|div|section|article|aside|header|footer|nav|details|form|fieldset|address';

const OPEN_BLOCK = new RegExp(`(<(?:${BLOCK_TAGS})(?:[\\s/>]))`, 'gi');
const CLOSE_BLOCK = new RegExp(`(</(?:${BLOCK_TAGS})>)`, 'gi');
const OPEN_CONTAINER_END = new RegExp(`(<(?:${CONTAINER_TAGS})(?:\\s[^>]*)?>)`, 'gi');
const CLOSE_CONTAINER = new RegExp(`(</(?:${CONTAINER_TAGS})>)`, 'gi');
const STARTS_WITH_BLOCK = new RegExp(`^</?(?:${BLOCK_TAGS})(?:[\\s/>])`, 'i');
const PRE = /<pre[\s>][\s\S]*?<\/pre>/gi;

export const isBlockEditorContent = (html: string) => html.includes('<!-- wp:');

export const autop = (html: string): string => {
  if (html.trim().length === 0 || isBlockEditorContent(html)) {
    return html;
  }
  const preserved: string[] = [];
  const text = html
    .replace(PRE, (match) => `<pre data-autop="${preserved.push(match) - 1}"></pre>`)
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
    .replace(OPEN_BLOCK, '\n\n$1')
    .replace(CLOSE_BLOCK, '$1\n\n')
    .replace(OPEN_CONTAINER_END, '$1\n\n')
    .replace(CLOSE_CONTAINER, '\n\n$1');
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => (STARTS_WITH_BLOCK.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, '<br />\n')}</p>`))
    .join('\n')
    .replace(/<pre data-autop="(\d+)"><\/pre>/g, (_, index: string) => preserved[Number(index)] ?? '');
};
