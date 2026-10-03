import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // The module build: `import { shapioAttr, initVisualEditing } from '@shapio/visual'`.
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    fixedExtension: false,
  },
  {
    // The plain-script build: `<script src=".../visual.iife.js" data-shapio-origin="https://cms.example.com">`.
    entry: { visual: 'src/global.ts' },
    format: 'iife',
    globalName: 'ShapioVisual',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    dts: false,
  },
]);
