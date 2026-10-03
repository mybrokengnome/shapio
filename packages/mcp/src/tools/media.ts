import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { uploadFile } from '@shapio/client/node';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { runTool } from './results.js';

/**
 * The file a `media_upload` may read: inside the media root after resolving symlinks, so an agent (or text
 * injected into what it reads) cannot have the server read ~/.ssh or anything else outside the project.
 */
export const resolveMediaPath = async (mediaRoot: string, path: string): Promise<string> => {
  const root = await realpath(mediaRoot);
  const target = await realpath(resolve(root, path)).catch(() => {
    throw new Error(`No file at ${path} (relative to the media root ${root})`);
  });
  const inside = relative(root, target);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(
      `media_upload only reads files under the media root (${root}); start the server with --media-root to change it`,
    );
  }
  return target;
};

/** The media library: browse, and upload files from the media root. */
export const registerMediaTools = ({ server, client, options }: ToolContext) => {
  server.registerTool(
    'media_list',
    {
      title: 'List media',
      description: 'A page of media assets (ID, filename, type, alt text, visibility, URLs), newest first.',
      inputSchema: z.object({
        folder: z.string().optional().describe('A folder ID, or "root" for assets in no folder'),
        mimeType: z.string().optional().describe('"image/png" or "image/*"'),
        search: z.string().optional(),
        cursor: z.string().optional().describe('nextCursor of the previous page'),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (query) => runTool(() => client.admin.media.assets.list(query)),
  );

  server.registerTool(
    'media_upload',
    {
      title: 'Upload a file',
      description:
        `Uploads a local file into the media library and returns the asset (use its ID in media fields). Only ` +
        `files under ${options.mediaRoot} can be read. Media is stored at once (it is not part of change sets).`,
      inputSchema: z.object({
        path: z.string().min(1).describe('Path relative to the media root (or absolute, inside it)'),
        alt: z.string().max(1000).optional().describe('Alt text for images'),
        mimeType: z.string().optional().describe('Needed when the extension is not a common one'),
        folderId: z.string().optional(),
        visibility: z.enum(['public', 'private']).optional(),
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ path, alt, mimeType, folderId, visibility }) =>
      runTool(async () => {
        const file = await resolveMediaPath(options.mediaRoot, path);
        const asset = await uploadFile(client, {
          baseUrl: options.baseUrl,
          path: file,
          ...(mimeType ? { mimeType } : {}),
          ...(folderId ? { folderId } : {}),
          ...(visibility ? { visibility } : {}),
        });
        return alt
          ? client.admin.media.assets.update(asset.id, { expectedVersion: asset.version, alt })
          : asset;
      }),
  );
};
