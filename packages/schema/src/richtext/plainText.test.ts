import { describe, expect, it } from 'vitest';
import { richTextPlainText } from './plainText.js';

const doc = (...content: unknown[]) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content },
});
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('richTextPlainText', () => {
  it('joins blocks and list items with a space', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      paragraph('First'),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph('one')] },
          { type: 'listItem', content: [paragraph('two')] },
        ],
      },
    );
    expect(richTextPlainText(value)).toBe('Title First one two');
  });

  it('reads anything that is not a document as no text', () => {
    expect(richTextPlainText('plain text')).toBe('');
    expect(richTextPlainText(null)).toBe('');
    expect(richTextPlainText({ doc: { type: 'doc', content: 'x' } })).toBe('');
  });
});
