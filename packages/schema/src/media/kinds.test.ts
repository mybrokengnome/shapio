import { describe, expect, it } from 'vitest';
import { mediaKindOf } from './kinds.js';

describe('mediaKindOf', () => {
  it('maps the image, video and audio families', () => {
    expect(mediaKindOf('image/png')).toBe('image');
    expect(mediaKindOf('image/svg+xml')).toBe('image');
    expect(mediaKindOf('video/mp4')).toBe('video');
    expect(mediaKindOf('audio/mpeg')).toBe('audio');
  });

  it('ignores case', () => {
    expect(mediaKindOf('Image/PNG')).toBe('image');
    expect(mediaKindOf('APPLICATION/PDF')).toBe('document');
    expect(mediaKindOf('Application/RTF')).toBe('document');
  });

  it('treats text, pdf, office, rtf and epub files as documents', () => {
    expect(mediaKindOf('text/plain')).toBe('document');
    expect(mediaKindOf('text/csv')).toBe('document');
    expect(mediaKindOf('application/pdf')).toBe('document');
    expect(mediaKindOf('application/msword')).toBe('document');
    expect(mediaKindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      'document',
    );
    expect(mediaKindOf('application/vnd.oasis.opendocument.text')).toBe('document');
    expect(mediaKindOf('application/rtf')).toBe('document');
    expect(mediaKindOf('text/rtf')).toBe('document');
    expect(mediaKindOf('application/epub+zip')).toBe('document');
  });

  it('puts everything else under other', () => {
    expect(mediaKindOf('application/zip')).toBe('other');
    expect(mediaKindOf('application/json')).toBe('other');
    expect(mediaKindOf('application/x-pdf')).toBe('other');
    expect(mediaKindOf('font/woff2')).toBe('other');
    expect(mediaKindOf('')).toBe('other');
    expect(mediaKindOf('not-a-mime-type')).toBe('other');
  });
});
