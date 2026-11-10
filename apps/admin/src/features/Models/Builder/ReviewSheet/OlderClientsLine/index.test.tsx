// @vitest-environment jsdom
import '@/test/dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OlderClientsLine } from '.';

describe('OlderClientsLine', () => {
  it('words the proposed change, and says "no change" when only an earlier change emptied values', () => {
    render(<OlderClientsLine effect="unchanged" />);
    expect(screen.getByText('No change for clients naming an older schema version')).toBeTruthy();
    render(<OlderClientsLine effect="nulled" />);
    expect(screen.getByText('Clients naming an older schema version get this field empty')).toBeTruthy();
  });
});
