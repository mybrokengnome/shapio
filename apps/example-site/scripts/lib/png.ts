import { crc32, deflateSync } from 'node:zlib';

/**
 * A dependency-free PNG encoder for the seed's placeholder images: an RGB diagonal gradient between two
 * colours with a soft circle, so variants and galleries have something to show.
 */
export type Rgb = readonly [number, number, number];

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const mix = (from: number, to: number, t: number) => Math.round(from + (to - from) * t);

export const createPng = (width: number, height: number, from: Rgb, to: Rgb): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height);
  const radius = Math.min(width, height) / 4;
  for (let y = 0; y < height; y += 1) {
    pixels[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const inCircle = (x - width * 0.68) ** 2 + (y - height * 0.42) ** 2 < radius ** 2;
      const offset = y * stride + 1 + x * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = mix(from[channel] ?? 0, to[channel] ?? 0, t);
        pixels[offset + channel] = inCircle ? Math.min(255, value + 40) : value;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
