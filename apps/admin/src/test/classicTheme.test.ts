import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_DIR } from './sourceFiles';

/**
 * Cobalt (key `classic`) is the admin's original dark palette, verbatim (docs/plans/themes.md, acceptance 2):
 * these are the values styles/index.css carried for `.dark` before themes existed. Only the brand tokens (the
 * new logo) are new.
 */
const DARK = {
  background: '#0f0f0e',
  foreground: '#f2f1ee',
  card: '#161615',
  'card-foreground': '#f2f1ee',
  popover: '#1c1c1a',
  'popover-foreground': '#f2f1ee',
  primary: '#2563eb',
  'primary-foreground': '#ffffff',
  'primary-hover': '#1d4ed8',
  secondary: '#232321',
  'secondary-foreground': '#f2f1ee',
  muted: '#1f1f1d',
  'muted-foreground': '#a9a7a1',
  accent: '#262a3a',
  'accent-foreground': '#c7d0fd',
  destructive: '#ef5350',
  'destructive-foreground': '#0f0f0e',
  'destructive-muted': '#3b1519',
  success: '#4ade80',
  'success-muted': '#12301f',
  warning: '#fbbf24',
  'warning-muted': '#36270a',
  info: '#a5b4fc',
  'info-muted': '#1e2a4a',
  border: '#2c2c29',
  input: '#76756f',
  ring: '#a5b4fc',
  link: '#a5b4fc',
  overlay: '#000000',
  sidebar: '#0b0b0a',
  'sidebar-foreground': '#e4e2dd',
  'sidebar-primary': '#a5b4fc',
  'sidebar-primary-foreground': '#0f0f0e',
  'sidebar-accent': '#1e1e1c',
  'sidebar-accent-foreground': '#a5b4fc',
  'sidebar-border': '#232321',
  'sidebar-ring': '#a5b4fc',
};

const CSS = readFileSync(join(SRC_DIR, 'styles', 'themes', 'classic.css'), 'utf8');

const blockValues = (selector: string) => {
  const start = CSS.indexOf(`${selector} {`);
  const block = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .map((m): [string, string] => [m[1] ?? '', (m[2] ?? '').trim()])
      .filter(([token]) => !token.startsWith('brand-')),
  );
};

describe('Cobalt theme (key classic)', () => {
  it('keeps the original dark values', () => {
    expect(blockValues("[data-theme='classic']")).toEqual(DARK);
  });
});
