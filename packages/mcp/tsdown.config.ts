import { defineConfig } from 'tsdown';

/** The library entry and the `shapio-mcp` bin. Dependencies (the MCP SDK, @shapio/*) stay external. */
export default defineConfig({
  entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: { entry: ['src/index.ts'] },
  sourcemap: true,
  fixedExtension: false,
  clean: true,
});
