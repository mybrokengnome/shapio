import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readSourceFiles } from './sourceFiles';

/** Attributes whose value is read or announced to the user, so it must come from translations. */
const USER_FACING_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
  'label',
]);

const HAS_LETTERS = /\p{L}/u;

/** Utilities that take a colour. */
const COLOUR_UTILITY =
  '(?:bg|text|border(?:-[xytrbl])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|shadow|decoration|caret|accent|divide|placeholder)';
/**
 * A literal colour in an arbitrary value (`bg-[#fff]`, `text-[rgb(0_0_0)]`). `var(--x)` stays allowed: it is
 * how a truly dynamic colour (a user-picked swatch) reaches a class (DESIGN.md, tokens).
 */
const ARBITRARY_COLOUR = new RegExp(
  `(?<![\\w-])${COLOUR_UTILITY}-\\[(?:#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|lab\\(|lch\\(|color\\()`,
);
/** Tailwind's default palette (`bg-green-100`, `text-white`): components use the theme tokens instead. */
const DEFAULT_PALETTE = new RegExp(
  `(?<![\\w-])${COLOUR_UTILITY}-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b|(?<![\\w-])${COLOUR_UTILITY}-(?:white|black)\\b`,
);

const findLines = (pattern: RegExp) =>
  readSourceFiles(['.ts', '.tsx']).flatMap(({ path, text }) =>
    text
      .split('\n')
      .map((line, index) => ({ file: path, line: index + 1, text: line.trim() }))
      .filter(({ text: line }) => pattern.test(line)),
  );

type Finding = { file: string; line: number; text: string };

const findHardcodedText = (path: string, text: string): Finding[] => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const report = (node: ts.Node, value: string) =>
    findings.push({
      file: path,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: value.trim(),
    });
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && HAS_LETTERS.test(node.text)) {
      report(node, node.text);
    }
    if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(source))) {
      const { initializer } = node;
      if (initializer && ts.isStringLiteral(initializer) && HAS_LETTERS.test(initializer.text)) {
        report(node, initializer.text);
      }
    }
    // {'Some text'} as a JSX child
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      HAS_LETTERS.test(node.expression.text)
    ) {
      report(node, node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

describe('admin source conventions', () => {
  it('renders no hard-coded user-facing text (every string comes from translation.json)', () => {
    const findings = readSourceFiles(['.tsx']).flatMap(({ path, text }) => findHardcodedText(path, text));
    expect(findings).toEqual([]);
  });

  it('uses no raw hex colours outside the Tailwind theme (DESIGN.md: design tokens only)', () => {
    const findings = readSourceFiles(['.ts', '.tsx']).flatMap(({ path, text }) =>
      text
        .split('\n')
        .map((line, index) => ({ file: path, line: index + 1, text: line.trim() }))
        .filter(({ text: line }) => /#[0-9a-f]{3,8}\b/i.test(line)),
    );
    expect(findings).toEqual([]);
  });

  it('uses no literal colours in arbitrary values (bg-[#fff], text-[rgb(...)])', () => {
    expect(findLines(ARBITRARY_COLOUR)).toEqual([]);
  });

  it("uses no colours from Tailwind's default palette (bg-green-100, text-white): theme tokens only", () => {
    expect(findLines(DEFAULT_PALETTE)).toEqual([]);
  });

  it('builds no class names by interpolation (Tailwind cannot see them)', () => {
    const findings = readSourceFiles(['.tsx']).flatMap(({ path, text }) =>
      text
        .split('\n')
        .map((line, index) => ({ file: path, line: index + 1, text: line.trim() }))
        .filter(({ text: line }) => /className=\{`[^`]*\$\{/.test(line)),
    );
    expect(findings).toEqual([]);
  });

  it('opens no centred dialogs: ui/dialog stays unused and AlertDialogContent lives only in ConfirmDialog', () => {
    const findings = readSourceFiles(['.ts', '.tsx']).flatMap(({ path, text }) => {
      if (path.startsWith('components/ui/')) {
        return [];
      }
      const problems: string[] = [];
      if (/from '@\/components\/ui\/dialog'/.test(text)) {
        problems.push(
          `${path}: imports @/components/ui/dialog (use FormSheet, InlineConfirm or ConfirmDialog)`,
        );
      }
      if (/\bAlertDialogContent\b/.test(text) && path !== 'components/ConfirmDialog/index.tsx') {
        problems.push(`${path}: uses AlertDialogContent (use ConfirmDialog)`);
      }
      return problems;
    });
    expect(findings).toEqual([]);
  });

  it('keeps non-modal sheets to the panels people work beside (the entry settings drawer)', () => {
    const allowed = new Set(['features/Content/Entry/SettingsDrawer/index.tsx']);
    const findings = readSourceFiles(['.tsx']).flatMap(({ path, text }) => {
      if (path.startsWith('components/ui/')) {
        return [];
      }
      const usesNonModal = /<Sheet\b[^>]*\bmodal=\{false\}/.test(text) || /\bnonModal\b/.test(text);
      if (!usesNonModal) {
        return [];
      }
      const problems: string[] = [];
      if (!allowed.has(path)) {
        problems.push(`${path}: a non-modal sheet outside the allowed panels (DESIGN.md "Dialogs")`);
      }
      if (!/<Sheet\b[^>]*\bmodal=\{false\}/.test(text) || !/\bnonModal\b/.test(text)) {
        problems.push(`${path}: pair <Sheet modal={false}> with <SheetContent nonModal>`);
      }
      return problems;
    });
    expect(findings).toEqual([]);
  });

  it('uses named exports only', () => {
    const findings = readSourceFiles(['.ts', '.tsx']).filter(({ text }) => /^export default /m.test(text));
    expect(findings.map(({ path }) => path)).toEqual([]);
  });
});

describe('the colour checks', () => {
  it('catch literal arbitrary colours and default-palette colours, not tokens or variables', () => {
    expect(ARBITRARY_COLOUR.test('bg-[#2563eb]')).toBe(true);
    expect(ARBITRARY_COLOUR.test('hover:text-[rgb(0_0_0)]')).toBe(true);
    expect(ARBITRARY_COLOUR.test('bg-[var(--swatch)]')).toBe(false);
    expect(ARBITRARY_COLOUR.test('transition-[color,box-shadow]')).toBe(false);
    expect(DEFAULT_PALETTE.test('bg-green-100')).toBe(true);
    expect(DEFAULT_PALETTE.test('dark:text-white')).toBe(true);
    expect(DEFAULT_PALETTE.test('bg-black/50')).toBe(true);
    expect(DEFAULT_PALETTE.test('bg-success-muted text-primary border-input')).toBe(false);
    expect(DEFAULT_PALETTE.test('bg-overlay/50')).toBe(false);
  });
});

describe('the hard-coded text check', () => {
  it('catches JSX text, user-facing attributes and string children', () => {
    const sample = `export const A = () => (
      <div title="Hi there">
        Hello
        {'World'}
        <input placeholder={t('x')} className="p-4" />
      </div>
    );`;
    expect(findHardcodedText('a.tsx', sample).map(({ text }) => text)).toEqual([
      'Hi there',
      'Hello',
      'World',
    ]);
  });
});
