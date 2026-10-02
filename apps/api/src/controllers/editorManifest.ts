import { readFile } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';

type EditorFileRequest = FastifyRequest<{ Params: { file: string } }>;

const EDITORS_PATH = '/api/admin/extensions/editors';

/** The installed editors, with the path (relative to the server's base URL) the admin imports each from. */
export const listEditors = async (request: FastifyRequest) => ({
  items: request.server.editorManifest.entries.map(({ file, hash }) => ({
    file,
    hash,
    path: `${EDITORS_PATH}/${encodeURIComponent(file)}?v=${hash}`,
  })),
});

/** One editor module. Only files in the manifest are served, so nothing else on disk is reachable. */
export const getEditorFile = async (request: EditorFileRequest, reply: FastifyReply) => {
  const entry = request.server.editorManifest.entries.find(
    (candidate) => candidate.file === request.params.file,
  );
  if (!entry) {
    throw request.server.httpErrors.notFound('No such editor');
  }
  return (
    reply
      .type('text/javascript; charset=utf-8')
      // The admin requests `?v=<hash>`, so a changed file always gets a new URL.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(await readFile(entry.path))
  );
};
