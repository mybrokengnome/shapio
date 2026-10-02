import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isMimeTypeAllowed, normalizeMimeType, sniffMediaType } from './sniff.js';

const ALLOWED = ['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/plain', 'application/json'];

/** The first bytes of real executables, padded. */
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]), Buffer.alloc(120)]);
const PE = Buffer.concat([
  Buffer.from('MZ'),
  Buffer.alloc(58),
  Buffer.from([0x80, 0, 0, 0]),
  Buffer.alloc(64),
  Buffer.from('PE\0\0'),
  Buffer.alloc(200),
]);

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#2563eb' } })
    .png()
    .toBuffer();

describe('media type sniffing', () => {
  it('normalizes and matches allowed types', () => {
    expect(normalizeMimeType(' Image/PNG; charset=binary')).toBe('image/png');
    expect(isMimeTypeAllowed('image/webp', ALLOWED)).toBe(true);
    expect(isMimeTypeAllowed('application/zip', ALLOWED)).toBe(false);
  });

  it('accepts an image whose bytes match', async () => {
    await expect(sniffMediaType(await png(), 'image/png', ALLOWED)).resolves.toEqual({
      ok: true,
      mimeType: 'image/png',
    });
  });

  it('trusts the bytes over a wrong but same-family declaration', async () => {
    await expect(sniffMediaType(await png(), 'image/jpeg', ALLOWED)).resolves.toEqual({
      ok: true,
      mimeType: 'image/png',
    });
  });

  it.each([
    ['an ELF binary', ELF, 'application/x-elf'],
    ['a Windows executable', PE, 'application/x-msdownload'],
  ])('rejects %s renamed to .png', async (_label, bytes, detected) => {
    await expect(sniffMediaType(bytes, 'image/png', ALLOWED)).resolves.toEqual({
      ok: false,
      code: 'TYPE_NOT_ALLOWED',
      detected,
    });
  });

  it('rejects allowed bytes declared as another family', async () => {
    await expect(sniffMediaType(await png(), 'application/pdf', ALLOWED)).resolves.toMatchObject({
      ok: false,
      code: 'TYPE_MISMATCH',
    });
  });

  it('accepts plain text only as a declared text type', async () => {
    const text = Buffer.from('hello, world\n');
    await expect(sniffMediaType(text, 'text/plain', ALLOWED)).resolves.toEqual({
      ok: true,
      mimeType: 'text/plain',
    });
    await expect(sniffMediaType(text, 'image/png', ALLOWED)).resolves.toMatchObject({
      ok: false,
      code: 'TYPE_UNKNOWN',
    });
    await expect(sniffMediaType(Buffer.from([0, 1, 2, 3]), 'text/plain', ALLOWED)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('accepts SVG only when it has an svg root', async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(sniffMediaType(svg, 'image/svg+xml', ALLOWED)).resolves.toEqual({
      ok: true,
      mimeType: 'image/svg+xml',
    });
    await expect(sniffMediaType(Buffer.from('just text'), 'image/svg+xml', ALLOWED)).resolves.toMatchObject({
      ok: false,
    });
  });
});
