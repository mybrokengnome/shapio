import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { EditorManifest } from '../extensions/editorManifest.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Custom field editors from the project (read at startup; ADR 0009). */
    editorManifest: EditorManifest;
  }
}

/** The manifest is built from the project config by the app (extensions/editorManifest.ts). */
export const editorManifestPlugin = fp<{ manifest: EditorManifest }>(
  async (app: FastifyInstance, { manifest }) => {
    app.decorate('editorManifest', manifest);
  },
  { name: 'shapio-editor-manifest' },
);
