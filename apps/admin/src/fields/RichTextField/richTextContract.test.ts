import { RICHTEXT_FORMAT, RICHTEXT_FORMAT_VERSION, validateRichText } from '@shapio/schema';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { richTextExtensions } from './extensions';
import { normalizeHref, prepareRichText, sanitizePastedHtml, toRichTextValue } from './richTextDocument';

// The server's validator (`validateRichText`) is the contract (ADR 0003): what the editor produces must pass it
// unchanged.
const IMAGE = '9c9c9c9c-9999-4999-8999-999999999999';

/** The same baseline document as packages/schema/src/richtext/richtext.test.ts. */
const BASELINE_DOC = {
  type: 'doc',
  content: [
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
  ],
};

const schema = getSchema(richTextExtensions());

describe('rich-text editor schema (the shapio-richtext v1 contract)', () => {
  it('round-trips the baseline document exactly', () => {
    expect(Node.fromJSON(schema, BASELINE_DOC).toJSON()).toEqual(BASELINE_DOC);
  });

  it('produces documents the server validator accepts unchanged', () => {
    const value = toRichTextValue(
      Node.fromJSON(schema, BASELINE_DOC).toJSON() as typeof BASELINE_DOC & { type: 'doc' },
    );
    const result = validateRichText(value);
    expect(result.ok).toBe(true);
    expect(result.ok && result.document.doc).toEqual(BASELINE_DOC);
  });

  it('has exactly the nodes and marks the server allows', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'codeBlock',
        'doc',
        'hardBreak',
        'heading',
        'horizontalRule',
        'image',
        'listItem',
        'orderedList',
        'paragraph',
        'table',
        'tableCell',
        'tableHeader',
        'tableRow',
        'text',
      ].sort(),
    );
    expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'code', 'italic', 'link']);
    expect(Object.keys(schema.marks.link?.spec.attrs ?? {}).sort()).toEqual([
      'class',
      'href',
      'rel',
      'target',
    ]);
  });
});

describe('rich-text documents', () => {
  it('treats an empty editor as no value', () => {
    expect(toRichTextValue({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeNull();
    expect(
      toRichTextValue({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      }),
    ).toEqual({
      format: RICHTEXT_FORMAT,
      version: RICHTEXT_FORMAT_VERSION,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    });
  });

  it('opens plain text as paragraphs, refuses newer versions for editing, and flags garbage', () => {
    expect(prepareRichText('One\n\nTwo')).toEqual({
      status: 'ok',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
        ],
      },
    });
    expect(
      prepareRichText({
        format: RICHTEXT_FORMAT,
        version: 99,
        doc: { type: 'doc', content: [{ type: 'horizontalRule' }] },
      }),
    ).toMatchObject({
      status: 'newer',
      version: 99,
    });
    expect(prepareRichText({ format: 'html', version: 1, doc: '<p>x</p>' }).status).toBe('unreadable');
  });

  it('accepts only safe links, adding https:// to bare domains', () => {
    expect(normalizeHref('example.com/a')).toBe('https://example.com/a');
    expect(normalizeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(normalizeHref('/about')).toBe('/about');
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('  ')).toBeNull();
  });

  it('strips scripts, styles, comments and Office markup from pasted HTML', () => {
    expect(
      sanitizePastedHtml(
        '<!-- x --><style>p{color:red}</style><p>Hi<o:p></o:p></p><script>alert(1)</script><meta charset="utf-8">',
      ),
    ).toBe('<p>Hi</p>');
  });
});
