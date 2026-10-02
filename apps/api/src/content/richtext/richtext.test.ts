import { describe, expect, it } from 'vitest';
import { plainTextToRichText, renderRichTextHtml, richTextToPlainText } from './render.js';
import { richTextMediaIds, validateRichText } from './validate.js';

const IMAGE = '9c9c9c9c-9999-4999-8999-999999999999';
const envelope = (content: unknown[]) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content },
});

/** The baseline document the admin's Tiptap editor (package F) produces: the contract both sides share. */
export const BASELINE_DOCUMENT = envelope([
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }, { type: 'italic' }] },
      {
        type: 'text',
        text: 'site',
        marks: [
          { type: 'link', attrs: { href: 'https://shapio.dev', target: null, rel: null, class: null } },
        ],
      },
    ],
  },
  {
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
    ],
  },
  {
    type: 'orderedList',
    attrs: { start: 3, type: null },
    content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
  },
  { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }] },
  { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1 < 2;' }] },
  { type: 'horizontalRule' },
  { type: 'image', attrs: { mediaId: IMAGE, alt: 'A chair', title: null } },
  {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableHeader',
            attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }],
          },
          {
            type: 'tableCell',
            attrs: { colspan: 2, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }],
          },
        ],
      },
    ],
  },
]);

describe('rich text', () => {
  it('accepts the baseline node and mark set', () => {
    const result = validateRichText(BASELINE_DOCUMENT);
    expect(result.ok).toBe(true);
    expect(richTextMediaIds(result.ok ? result.document : (BASELINE_DOCUMENT as never))).toEqual([IMAGE]);
  });

  it.each([
    ['an unknown node', envelope([{ type: 'iframe' }]), '/doc/content/0'],
    [
      'an unknown attribute',
      envelope([{ type: 'paragraph', attrs: { style: 'x' } }]),
      '/doc/content/0/attrs/style',
    ],
    [
      'an unsafe link',
      envelope([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
      ]),
      '/doc/content/0/content/0/marks/0/attrs/href',
    ],
    [
      'marks in a code block',
      envelope([{ type: 'codeBlock', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }]),
      '/doc/content/0/content/0/marks',
    ],
    [
      'a block inside a paragraph',
      envelope([{ type: 'paragraph', content: [{ type: 'paragraph' }] }]),
      '/doc/content/0/content/0',
    ],
    [
      'an image without a media reference',
      envelope([{ type: 'image', attrs: { src: 'https://x/y.png' } }]),
      '/doc/content/0/attrs/src',
    ],
    ['an empty list', envelope([{ type: 'bulletList', content: [] }]), '/doc/content/0/content'],
  ])('rejects %s instead of stripping it', (_name, document, path) => {
    const result = validateRichText(document);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((problem) => problem.path)).toContain(path);
  });

  it('rejects a wrong envelope', () => {
    expect(validateRichText({ format: 'html', version: 1, doc: { type: 'doc' } }).ok).toBe(false);
    expect(validateRichText({ format: 'shapio-richtext', version: 2, doc: { type: 'doc' } }).ok).toBe(false);
    expect(validateRichText('<p>hi</p>').ok).toBe(false);
  });

  it('renders escaped HTML from JSON only, resolving images through the media layer', () => {
    const result = validateRichText(BASELINE_DOCUMENT);
    if (!result.ok) {
      throw new Error('invalid fixture');
    }
    const html = renderRichTextHtml(result.document, (id) =>
      id === IMAGE ? 'https://cdn.example/chair.jpg' : undefined,
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
    expect(html).toContain('<img src="https://cdn.example/chair.jpg" alt="A chair">');
    expect(html).toContain('<td colspan="2"><p>C</p></td>');
    expect(html).toContain('<ol start="3">');
    expect(renderRichTextHtml(result.document)).not.toContain('<img');
  });

  it('converts to and from plain text', () => {
    const document = plainTextToRichText('first line\nsecond\n\nnext paragraph');
    expect(validateRichText(document).ok).toBe(true);
    expect(richTextToPlainText(document)).toBe('first line\nsecond\n\nnext paragraph');
  });
});
