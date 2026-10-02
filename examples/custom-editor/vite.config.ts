import { defineConfig } from 'vite';

/**
 * Builds one ES module for `extensions/editors/`. React and the editor SDK stay bare imports: the Shapio
 * admin's import map resolves them to its own copies at runtime, so the editor shares the admin's React.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: () => 'star-rating.js' },
    rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', '@shapio/editor-sdk'] },
  },
});
