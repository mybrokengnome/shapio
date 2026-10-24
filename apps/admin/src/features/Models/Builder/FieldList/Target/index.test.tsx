// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { field } from '../../../../../../../../packages/schema/src/testing/fixtures';
import { Row as InheritedRow } from '../Inherited/Row';
import { Row } from '../Row';

/** A button whose accessible name says "points at {target}" and has no arrow in it. */
const readsAsPointsAt = (target: string) => (name: string) =>
  name.includes(`points at ${target}`) && !name.includes('→');

const related = { ...field({ apiKey: 'related', label: 'Related', type: 'relation' }), settings: {} };

describe('Target', () => {
  it('is read as "points at", never as an arrow', () => {
    render(
      <ol>
        <Row
          field={related as never}
          index={0}
          total={1}
          selected={false}
          hasIssues={false}
          showLocalized={false}
          target="Linkable (interface)"
          dropTarget={false}
          disabled={false}
          onSelect={vi.fn()}
          onMove={vi.fn()}
          onDragStart={vi.fn()}
          onDragOver={vi.fn()}
          onDrop={vi.fn()}
          onDragEnd={vi.fn()}
        />
      </ol>,
    );
    const row = screen.getByRole('button', { name: readsAsPointsAt('Linkable (interface)') });
    // The arrow is still there for the eye.
    expect(row.textContent).toContain('→ Linkable (interface)');
  });

  it('reads the same on an inherited row', () => {
    render(
      <ol>
        <InheritedRow
          field={related as never}
          selected={false}
          showLocalized={false}
          target="Page and 3 kinds"
          onSelect={vi.fn()}
        />
      </ol>,
    );
    expect(screen.getByRole('button', { name: readsAsPointsAt('Page and 3 kinds') })).toBeTruthy();
  });
});
