import { THEME_SEMANTIC_TOKENS } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { themeContrastWarnings } from './themeContrast.js';
import { buildThemeCatalogue } from './themeStylesheet.js';

const tokens = (value: string) => Object.fromEntries(THEME_SEMANTIC_TOKENS.map((token) => [token, value]));

describe('buildThemeCatalogue', () => {
  it('is empty without themes', () => {
    expect(buildThemeCatalogue([])).toEqual({ items: [], stylesheet: '' });
  });

  it('uses the built-in selectors: [data-theme] for the light or only variant, .dark for the second', () => {
    const { items, stylesheet } = buildThemeCatalogue([
      { key: 'night', name: 'Night', dark: { background: '#000000' } },
      { key: 'duo', name: 'Duo', description: 'Both', light: { card: '#ffffff' }, dark: { card: '#111111' } },
    ]);
    expect(items).toEqual([
      { key: 'night', name: 'Night', description: undefined, variants: ['dark'] },
      { key: 'duo', name: 'Duo', description: 'Both', variants: ['light', 'dark'] },
    ]);
    expect(stylesheet).toContain("[data-theme='night'] {\n  --background: #000000;\n}");
    expect(stylesheet).toContain("[data-theme='duo'] {\n  --card: #ffffff;\n}");
    expect(stylesheet).toContain("[data-theme='duo'].dark {\n  --card: #111111;\n}");
    expect(stylesheet).not.toContain("[data-theme='night'].dark");
  });
});

describe('themeContrastWarnings', () => {
  it('names each failing pair with its ratio, and says when values cannot be measured', () => {
    const warnings = themeContrastWarnings([
      { key: 'flat', name: 'Flat', light: tokens('#777777') },
      { key: 'fancy', name: 'Fancy', dark: { ...tokens('#000000'), foreground: 'oklch(90% 0 0)' } },
    ]);
    expect(warnings).toContain('flat (light): --foreground on --background is 1.00:1, needs 4.5:1');
    expect(warnings).toContain('fancy (dark): only #rrggbb values are checked for contrast');
  });
});
