import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  dts: true,
  sourcemap: true,
  fixedExtension: false,
  external: ['react', '@shapio/schema'],
});
