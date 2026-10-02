import { describe, expect, it } from 'vitest';
import { fileKindLabel } from './fileKind';

describe('fileKindLabel', () => {
  it('uses the file extension', () => {
    expect(fileKindLabel('hero.png', 'image/png')).toBe('PNG');
    expect(fileKindLabel('Terms.Final.pdf', 'application/pdf')).toBe('PDF');
  });

  it('falls back to the MIME subtype when there is no short extension', () => {
    expect(fileKindLabel('README', 'text/plain')).toBe('PLAIN');
    expect(fileKindLabel('logo', 'image/svg+xml')).toBe('SVG');
    expect(fileKindLabel('archive.verylongext', 'application/zip')).toBe('ZIP');
  });
});
