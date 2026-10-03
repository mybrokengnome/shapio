import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectHtmlImages, htmlToRichText, type HtmlImage } from './fromHtml.js';
import { validateRichText, type RichTextNode } from './validate.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/html/${name}`, import.meta.url), 'utf8');

const MEDIA_ID = '9c9c9c9c-9999-4999-8999-999999999999';
const resolveAll = () => MEDIA_ID;

/** `type:text` for textblocks (hard breaks as `|`), `type[children]` for containers. */
const outline = (node: RichTextNode): string => {
  const children = node.content ?? [];
  if (children.length > 0 && children.every((child) => child.type === 'text' || child.type === 'hardBreak')) {
    return `${node.type}:${children.map((child) => (child.type === 'hardBreak' ? '|' : child.text)).join('')}`;
  }
  return children.length > 0 ? `${node.type}[${children.map(outline).join(' ')}]` : node.type;
};

const blocksOf = (html: string, resolveImage?: (image: HtmlImage) => string | undefined) =>
  htmlToRichText(html, { resolveImage }).document.doc.content ?? [];

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };

describe('htmlToRichText', () => {
  it('maps paragraphs, headings and inline marks', () => {
    expect(blocksOf('<h3>Head</h3><p>a <strong>b</strong> <em>c</em> <code>d</code></p>')).toEqual([
      { type: 'heading', attrs: { level: 3 }, content: [text('Head')] },
      {
        type: 'paragraph',
        content: [
          text('a '),
          text('b', [{ type: 'bold' }]),
          text(' '),
          text('c', [{ type: 'italic' }]),
          text(' '),
          text('d', [{ type: 'code' }]),
        ],
      },
    ]);
  });

  it('collapses whitespace like a browser and keeps hard breaks', () => {
    expect(blocksOf('<p>\n  one   two <br>\n three  </p>')).toEqual([
      { type: 'paragraph', content: [text('one two'), { type: 'hardBreak' }, text('three')] },
    ]);
  });

  it('unwraps unknown elements and drops underline and strike marks', () => {
    expect(blocksOf('<p><span>a</span> <u>b</u> <s>c</s> <font>d</font></p>')).toEqual([
      { type: 'paragraph', content: [text('a b c d')] },
    ]);
  });

  it('wraps loose inline content in paragraphs and drops empty ones', () => {
    expect(blocksOf('loose <p>&nbsp;</p><div>in div<p>p</p>after</div>')).toEqual([
      { type: 'paragraph', content: [text('loose')] },
      { type: 'paragraph', content: [text('in div')] },
      { type: 'paragraph', content: [text('p')] },
      { type: 'paragraph', content: [text('after')] },
    ]);
  });

  it('maps lists with nesting, start and type', () => {
    expect(blocksOf('<ol start="3" type="a"><li>x<ul><li>y</li></ul></li></ol>')).toEqual([
      {
        type: 'orderedList',
        attrs: { start: 3, type: 'a' },
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [text('x')] },
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('y')] }] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(blocksOf('<ul></ul>')).toEqual([]);
  });

  it('keeps safe links and drops unsafe ones with a warning', () => {
    const { document, warnings } = htmlToRichText(
      '<p><a href="https://x.dev" target="_blank">ok</a> <a href="javascript:alert(1)">bad</a> <a>none</a></p>',
    );
    expect(document.doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          text('ok', [
            { type: 'link', attrs: { href: 'https://x.dev', target: '_blank', rel: null, class: null } },
          ]),
          text(' bad none'),
        ],
      },
    ]);
    expect(warnings).toEqual([{ code: 'unsafeLink', detail: 'javascript:alert(1)' }]);
  });

  it('turns resolved images into image blocks, splitting the paragraph, and drops the rest', () => {
    const seen: HtmlImage[] = [];
    const result = htmlToRichText(
      '<p>before <img src="/a.png" alt="A" title="T"> after <img src="/b.png"></p>',
      {
        resolveImage: (image) => {
          seen.push(image);
          return image.src === '/a.png' ? MEDIA_ID : undefined;
        },
      },
    );
    expect(seen.map((image) => image.src)).toEqual(['/a.png', '/b.png']);
    expect(result.document.doc.content).toEqual([
      { type: 'paragraph', content: [text('before')] },
      { type: 'image', attrs: { mediaId: MEDIA_ID, alt: 'A', title: 'T' } },
      { type: 'paragraph', content: [text('after')] },
    ]);
    expect(result.warnings).toEqual([{ code: 'imageUnresolved', detail: '/b.png' }]);
  });

  it('maps code blocks with their language and keeps their whitespace', () => {
    expect(
      blocksOf('<pre><code class="language-ts">  a\n    b\n</code></pre><pre class="x">raw</pre>'),
    ).toEqual([
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('  a\n    b')] },
      { type: 'codeBlock', attrs: { language: null }, content: [text('raw')] },
    ]);
  });

  it('maps tables with header cells and spans', () => {
    expect(blocksOf('<table><tr><th colspan="2">h</th></tr><tr><td>a</td><td></td></tr></table>')).toEqual([
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 2, rowspan: 1, colwidth: null },
                content: [{ type: 'paragraph', content: [text('h')] }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: 'paragraph', content: [text('a')] }],
              },
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: 'paragraph' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('maps blockquotes and horizontal rules, and drops scripts and embeds', () => {
    const { document, warnings } = htmlToRichText(
      '<blockquote>q</blockquote><hr><script>x()</script><iframe src="https://v"></iframe>',
    );
    expect(document.doc.content).toEqual([
      { type: 'blockquote', content: [{ type: 'paragraph', content: [text('q')] }] },
      { type: 'horizontalRule' },
    ]);
    expect(warnings).toEqual([{ code: 'embedDropped', detail: 'iframe' }]);
  });

  it('flattens nesting deeper than the document allows', () => {
    const html = `${'<blockquote>'.repeat(60)}deep${'</blockquote>'.repeat(60)}`;
    const result = htmlToRichText(html);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result.document)).toContain('deep');
  });

  it('returns an empty document for empty input', () => {
    expect(htmlToRichText('  ').document).toEqual({
      format: 'shapio-richtext',
      version: 1,
      doc: { type: 'doc' },
    });
  });

  it.each([
    [
      'gutenberg.html',
      [
        'heading:Getting started',
        'paragraph:Shapio keeps models as data, see the docs.',
        'image',
        'paragraph:The hero, captioned.',
        'bulletList[listItem[paragraph:First] listItem[paragraph:Second bulletList[listItem[paragraph:Nested]]]]',
        'blockquote[paragraph:Quoted text. paragraph:Someone]',
        'codeBlock:const x = 1;\nconsole.log(x);',
        'horizontalRule',
        'table[tableRow[tableHeader[paragraph:Name] tableHeader[paragraph:Value]] tableRow[tableCell[paragraph:a] tableCell[paragraph:1]]]',
      ],
      ['embedDropped'],
    ],
    [
      'kitchen-sink.html',
      [
        'heading:Title & more',
        'paragraph:Loose text before a block',
        'paragraph:Line one|Line two with underline, strike, colour and code.',
        'orderedList[listItem[paragraph:Third] listItem[paragraph:Fourth both]]',
        'paragraph:Links: bad, relative, mail, bare.',
        'paragraph:Inline',
        'image',
        'paragraph:image that cannot be resolved.',
        'codeBlock:  indented\n    code',
        'paragraph:Inside a div',
        'paragraph:text after',
      ],
      ['unsafeLink', 'unsafeLink'],
    ],
  ])('converts %s into a valid document', (name, expected, warningCodes) => {
    const result = htmlToRichText(fixture(name), { resolveImage: resolveAll });
    expect(validateRichText(result.document)).toMatchObject({ ok: true, document: result.document });
    expect((result.document.doc.content ?? []).map(outline)).toEqual(expected);
    expect(result.warnings.map((warning) => warning.code)).toEqual(warningCodes);
  });
});

describe('collectHtmlImages', () => {
  it('lists images in document order with alt and title', () => {
    expect(
      collectHtmlImages(
        '<p><img src=" /a.png " alt="A"></p><figure><img src="/b.png" title="B"><img></figure>',
      ),
    ).toEqual([
      { src: '/a.png', alt: 'A', title: null },
      { src: '/b.png', alt: null, title: 'B' },
    ]);
  });
});
