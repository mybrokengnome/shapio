import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/html.ts', 'src/seoResolve.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: true,
  sourcemap: true,
  fixedExtension: false,
});
