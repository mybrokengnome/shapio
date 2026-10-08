// @vitest-environment jsdom
import '@/test/dom';
import type { DataType } from '@shapio/schema';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ValueCell } from '.';

type CellProps = { value: unknown; summary: string | null; type: DataType; side?: 'before' | 'after' };

const renderCell = ({ value, summary, type, side = 'after' }: CellProps) =>
  render(
    <table>
      <tbody>
        <tr>
          <ValueCell value={value} summary={summary} type={type} side={side} />
        </tr>
      </tbody>
    </table>,
  );

const DOC = {
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
};

describe('ValueCell', () => {
  it('shows a structured value as its summary with the raw JSON behind a keyboard-reachable disclosure', async () => {
    const { container } = renderCell({ value: DOC, summary: 'Hello', type: 'richtext' });
    expect(screen.getByText('Hello').tagName).toBe('SPAN');
    const details = container.querySelector('details');
    const summary = screen.getByText('Raw').closest('summary');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('pre')?.textContent).toBe(JSON.stringify(DOC));

    await userEvent.tab();
    expect(document.activeElement).toBe(summary);
    await userEvent.click(screen.getByText('Raw'));
    expect(details?.open).toBe(true);
  });

  it.each<[DataType, unknown, string]>([
    ['media', ['a1', 'a2'], 'hero.png, map.webp'],
    ['relation', ['e1'], 'Hello world'],
    ['component', { title: 'Hi' }, 'SEO: Hi'],
    ['dynamiczone', [{ __component: 'c1' }], '1 block: Hero'],
    ['json', { a: 1 }, '{"a":1}'],
    ['code', '<p>\n</p>', 'HTML, 2 lines'],
  ])('uses the summary for %s', (type, value, summary) => {
    renderCell({ value, summary, type });
    expect(screen.getAllByText(summary)[0]?.tagName).toBe('SPAN');
    expect(screen.getByText('Raw')).toBeDefined();
  });

  it('keeps scalars as stored, without a disclosure', () => {
    renderCell({ value: true, summary: 'Yes', type: 'boolean' });
    expect(screen.getByText('true')).toBeDefined();
    expect(screen.queryByText('Yes')).toBeNull();
    expect(screen.queryByText('Raw')).toBeNull();
  });

  it('strikes through the old value and reads "empty" when there is none', () => {
    renderCell({ value: 'Old title', summary: 'Old title', type: 'string', side: 'before' });
    expect(screen.getByText('Old title').classList.contains('line-through')).toBe(true);
    renderCell({ value: null, summary: null, type: 'richtext' });
    expect(screen.getByText('empty')).toBeDefined();
  });

  it('falls back to the raw value when a structured value has no summary', () => {
    renderCell({ value: { a: 1 }, summary: null, type: 'json' });
    expect(screen.getByText('{"a":1}').tagName).toBe('SPAN');
    expect(screen.queryByText('Raw')).toBeNull();
  });
});
