import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY, summarizeValue, type SummaryLookups } from './reviewSummary.js';

const field = (type: string, settings: Record<string, unknown> = {}): FieldDefinition =>
  ({ id: `f-${type}`, apiKey: type, label: type, type, settings }) as unknown as FieldDefinition;

const LINK: ComponentDefinition = {
  id: 'c-link',
  kind: 'component',
  apiKey: 'link',
  label: 'Link',
  display: {},
  fields: [field('url'), { ...field('string'), id: 'f-text' }],
} as unknown as ComponentDefinition;
const HERO: ComponentDefinition = {
  ...LINK,
  id: 'c-hero',
  apiKey: 'hero',
  label: 'Hero',
  fields: [{ ...field('string'), id: 'f-heading' }],
};

const lookups: SummaryLookups = {
  component: (id) => [LINK, HERO].find((component) => component.id === id),
  mediaName: (id) => ({ 'a-1': 'hero.png', 'a-2': 'map.webp' })[id],
  entryTitle: (id) => ({ 'e-1': 'Ada' })[id],
};
const summary = (type: string, value: unknown, settings?: Record<string, unknown>) =>
  summarizeValue(field(type, settings), value, lookups);

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const richText = (...texts: string[]) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: texts.map(paragraph) },
});

describe('summarizeValue', () => {
  it('reads empty values as null', () => {
    for (const value of [null, undefined, '', [], {}]) {
      expect(summary('string', value)).toBeNull();
    }
  });

  it('rich text: its text, cut with an ellipsis', () => {
    expect(summary('richtext', richText('Hello', 'world'))).toBe('Hello world');
    const long = summary('richtext', richText('x'.repeat(400))) ?? '';
    expect(long).toHaveLength(MAX_SUMMARY);
    expect(long.endsWith('…')).toBe(true);
  });

  it('media: file names, the id when missing', () => {
    expect(summary('media', ['a-1', 'a-2', 'a-9'])).toBe('hero.png, map.webp, a-9');
    expect(summary('media', 'a-1')).toBe('hero.png');
  });

  it('relation: titles, the id when missing or unreadable', () => {
    expect(summary('relation', ['e-1', 'e-2'], { target: 'm', cardinality: 'many' })).toBe('Ada, e-2');
  });

  it('component: label and item summary (title field, else the first text field)', () => {
    expect(
      summary('component', { 'f-url': 'https://x.test', 'f-text': 'Home' }, { component: 'c-link' }),
    ).toBe('Link: https://x.test');
    expect(
      summary('component', [{ 'f-text': 'Home' }, { 'f-text': 'About' }], {
        component: 'c-link',
        repeatable: true,
      }),
    ).toBe('2 items (Link): Home, About');
    expect(summary('component', {}, { component: 'c-link' })).toBeNull();
  });

  it('dynamic zone: block count and labelled blocks', () => {
    expect(
      summary('dynamiczone', [
        { __component: 'c-hero', 'f-heading': 'Welcome' },
        { __component: 'c-link' },
        { __component: 'c-gone' },
      ]),
    ).toBe('3 blocks: Hero (Welcome), Link, c-gone');
  });

  it('code: language and lines', () => {
    expect(summary('code', '<div>\n  <p>Hi</p>\n</div>', { language: 'html' })).toBe('HTML, 3 lines');
    expect(summary('code', 'x', { language: 'plain' })).toBe('Plain text, 1 line');
  });

  it('json: compact JSON', () => {
    expect(summary('json', { a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it('enum: labels', () => {
    const values = [
      { value: 'draft', label: 'Draft' },
      { value: 'live', label: 'Live' },
    ];
    expect(summary('enum', 'live', { values })).toBe('Live');
    expect(summary('enum', ['draft', 'other'], { values, multiple: true })).toBe('Draft, other');
  });

  it('boolean: Yes or No; scalars and dates as stored', () => {
    expect(summary('boolean', true)).toBe('Yes');
    expect(summary('boolean', false)).toBe('No');
    expect(summary('integer', 42)).toBe('42');
    expect(summary('datetime', '2026-10-08T10:00:00.000Z')).toBe('2026-10-08T10:00:00.000Z');
  });

  it('falls back to compact JSON when a value does not match its field (unconverted on ship)', () => {
    expect(summary('richtext', 'plain before conversion')).toBe('plain before conversion');
    expect(summary('component', 'oops', { component: 'c-link' })).toBe('oops');
    expect(summary('media', { id: 1 })).toBe('{"id":1}');
  });
});
