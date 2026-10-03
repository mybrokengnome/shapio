import { describe, expect, it } from 'vitest';
import { cleanModelText, fitToLength } from './text.js';

describe('model text helpers', () => {
  it('strips surrounding quotes and whitespace', () => {
    expect(cleanModelText('  "A calm harbour."  ')).toBe('A calm harbour.');
    expect(cleanModelText('«Un port calme»')).toBe('Un port calme');
    expect(cleanModelText('Line one\n\n line two', { singleLine: true })).toBe('Line one line two');
  });

  it('cuts at a word boundary with an ellipsis, counting code points', () => {
    expect(fitToLength('short', 10)).toEqual({ text: 'short', truncated: false });
    const cut = fitToLength('Boats leave the harbour at dawn every day', 20);
    expect(cut).toEqual({ text: 'Boats leave the…', truncated: true });
    expect([...cut.text].length).toBeLessThanOrEqual(20);
    expect(fitToLength('😀😀😀😀😀', 3)).toEqual({ text: '😀😀…', truncated: true });
  });
});
