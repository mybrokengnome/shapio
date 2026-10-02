import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('lets a later class override an earlier one', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('keeps the custom font sizes apart from text colours', () => {
    expect(cn('text-title', 'text-muted-foreground')).toBe('text-title text-muted-foreground');
    expect(cn('text-meta', 'text-foreground')).toBe('text-meta text-foreground');
    expect(cn('text-2xs', 'text-primary')).toBe('text-2xs text-primary');
    expect(cn('text-display', 'text-foreground')).toBe('text-display text-foreground');
    expect(cn('text-canvas', 'text-foreground')).toBe('text-canvas text-foreground');
  });

  it('resolves conflicts between the custom and the built-in font sizes', () => {
    expect(cn('text-sm', 'text-meta')).toBe('text-meta');
    expect(cn('text-title', 'text-xl')).toBe('text-xl');
    expect(cn('text-display', 'text-title')).toBe('text-title');
    expect(cn('text-base', 'text-canvas')).toBe('text-canvas');
  });
});
