import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { component, field } from '../../../../../packages/schema/src/testing/fixtures';
import { summarizeItem, summarizeValue } from './summary';

beforeAll(async () => {
  await initI18n();
});

const block = component({
  fields: [
    field({ apiKey: 'embed', type: 'code', settings: { language: 'html' } }),
    field({ apiKey: 'caption', type: 'string' }),
  ],
});
const [embed] = block.fields;

describe('summarizeValue for code', () => {
  it('names the language and the line count instead of showing the snippet', () => {
    expect(summarizeValue(embed!, '<div>\n  <p>Hi</p>\n</div>')).toBe('HTML, 3 lines');
    expect(summarizeValue(embed!, '<br>')).toBe('HTML, 1 line');
    expect(summarizeValue(embed!, null)).toBe('');
  });

  it('never labels a component item with a snippet', () => {
    expect(summarizeItem(block, { embed: '<script>x()</script>', caption: 'Map' })).toBe('Map');
  });
});

describe('summarizeValue for rich text', () => {
  const [body] = component({ fields: [field({ apiKey: 'body', type: 'richtext' })] }).fields;
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

  it('reads the document as plain text, blocks separated by a space', () => {
    const value = {
      format: 'shapio-richtext',
      version: 1,
      doc: { type: 'doc', content: [paragraph('Hello'), paragraph('world')] },
    };
    expect(summarizeValue(body!, value)).toBe('Hello world');
  });

  it('reads a value that is not a document as empty', () => {
    expect(summarizeValue(body!, 'not a document')).toBe('');
  });
});
