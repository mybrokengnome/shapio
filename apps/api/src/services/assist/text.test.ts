import { describe, expect, it } from 'vitest';
import { askWithinLength, cleanModelText, fitToLength, unwrapFence } from './text.js';

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

  it('unwraps a Markdown fence around the whole answer only', () => {
    expect(unwrapFence('```markdown\n## Pricing\n\nText.\n```')).toBe('## Pricing\n\nText.');
    expect(unwrapFence('  ```\nPlain.\n```  ')).toBe('Plain.');
    expect(unwrapFence('Intro.\n\n```js\nkeep();\n```')).toBe('Intro.\n\n```js\nkeep();\n```');
    expect(unwrapFence('```js\nkeep();\n```')).toBe('```js\nkeep();\n```');
  });

  it('asks again for a shorter answer once, then cuts to the maximum', async () => {
    const answers = ['far too long an answer', 'still too long'];
    const asked: boolean[] = [];
    const result = await askWithinLength(async (shorter) => {
      asked.push(shorter);
      return answers.shift() ?? '';
    }, 10);
    expect(asked).toEqual([false, true]);
    expect(result).toEqual({ text: 'still too…', truncated: true });
  });

  it('retries above a soft target without cutting to it', async () => {
    const answers = ['x'.repeat(80), 'y'.repeat(75)];
    const result = await askWithinLength(async () => answers.shift() ?? '', undefined, 70);
    expect(result).toEqual({ text: 'y'.repeat(75), truncated: false });
  });
});
