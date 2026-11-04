// @vitest-environment jsdom
import { generateJSON, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { richTextExtensions } from '../extensions';
import { markdownToHtml } from './markdownToHtml';

/** What the proposal editor would hold: the HTML parsed against the stored schema, as Tiptap does. */
const blocksOf = (markdown: string): JSONContent[] =>
  (generateJSON(markdownToHtml(markdown), richTextExtensions()).content ?? []) as JSONContent[];

const textOf = (blocks: readonly JSONContent[]): string =>
  blocks.map((block) => (block.text ?? '') + textOf(block.content ?? [])).join('');

describe('markdownToHtml', () => {
  it('turns headings, paragraphs, lists, quotes and marks into blocks of the stored format', () => {
    const blocks = blocksOf(
      [
        '## Pricing',
        '',
        'Plans start **monthly** or *yearly*, with `code`.',
        '',
        '- Monthly',
        '- Yearly',
        '',
        '1. First',
        '',
        '> A quote',
        '',
        '### Details',
      ].join('\n'),
    );
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'blockquote',
      'heading',
    ]);
    expect(blocks[0]).toMatchObject({ attrs: { level: 2 }, content: [{ text: 'Pricing' }] });
    expect(blocks[5]).toMatchObject({ attrs: { level: 3 } });
    const marks = (blocks[1]?.content ?? []).map((node) => node.marks?.[0]?.type ?? null);
    expect(marks).toEqual([null, 'bold', null, 'italic', null, 'code', null]);
    expect(textOf(blocks[2]?.content ?? [])).toBe('MonthlyYearly');
  });

  it('keeps raw HTML as visible text: no script, no element, no handler', () => {
    const html = markdownToHtml(
      'Before\n\n<script>alert(1)</script>\n\nAn <img src=x onerror="alert(2)"> inline',
    );
    expect(html).not.toMatch(/<script|<img/i);
    const blocks = blocksOf(
      'Before\n\n<script>alert(1)</script>\n\nAn <img src=x onerror="alert(2)"> inline',
    );
    expect(textOf(blocks)).toContain('<script>alert(1)</script>');
    expect(textOf(blocks)).toContain('<img src=x onerror="alert(2)">');
    expect(JSON.stringify(blocks)).not.toContain('"image"');
  });

  it('keeps only the text of links and drops images', () => {
    const blocks = blocksOf(
      'Read [the guide](https://example.com/guide) or [this](javascript:alert(1)).\n\n![A photo](https://example.com/a.png)',
    );
    expect(JSON.stringify(blocks)).not.toContain('"link"');
    expect(JSON.stringify(blocks)).not.toContain('example.com');
    expect(JSON.stringify(blocks)).not.toContain('"image"');
    expect(textOf(blocks)).toBe('Read the guide or this.');
  });

  it('leaves tables as text (GFM is off)', () => {
    const blocks = blocksOf('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(blocks.some((block) => block.type === 'table')).toBe(false);
  });
});
