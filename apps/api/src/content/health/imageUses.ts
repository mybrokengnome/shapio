import type { FieldDefinition, RichTextNode } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import type { ContentModel } from '../model.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { pointer } from '../validator/issues.js';

/**
 * One place a document shows an asset: a media field value (alt text comes from the library only) or a
 * rich-text image (its own `alt` overrides the library's). `occurrence` counts repeats of the same asset at
 * the same path, so two copies of one image in a body are two findings.
 */
export type ImageUse = { path: string; assetId: string; alt: string | null; occurrence: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const richTextImages = (node: RichTextNode, found: { assetId: string; alt: string | null }[]) => {
  if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') {
    const alt = typeof node.attrs.alt === 'string' && node.attrs.alt.trim() !== '' ? node.attrs.alt : null;
    found.push({ assetId: node.attrs.mediaId, alt });
  }
  (node.content ?? []).forEach((child) => richTextImages(child, found));
};

const componentOf = (model: ContentModel, id: unknown) =>
  typeof id === 'string' ? model.components.get(id)?.definition : undefined;

const collect = (
  model: ContentModel,
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  base: string,
  add: (path: string, assetId: string, alt: string | null) => void,
) => {
  for (const field of fields) {
    const value = data[field.id];
    const path = pointer(base, field.apiKey);
    if (value === undefined || value === null || field.deprecated) {
      continue;
    }
    switch (field.type) {
      case 'media':
        (Array.isArray(value) ? value : [value]).forEach(
          (id) => typeof id === 'string' && add(path, id, null),
        );
        break;
      case 'richtext': {
        const found: { assetId: string; alt: string | null }[] = [];
        if (isRecord(value) && isRecord(value.doc)) {
          richTextImages(value.doc as RichTextNode, found);
        }
        found.forEach((image) => add(path, image.assetId, image.alt));
        break;
      }
      case 'component': {
        const component = componentOf(model, field.settings.component);
        const items = field.settings.repeatable && Array.isArray(value) ? value : [value];
        items.forEach((item, index) => {
          if (component && isRecord(item)) {
            const itemPath = field.settings.repeatable ? pointer(path, index) : path;
            collect(model, component.fields, item, itemPath, add);
          }
        });
        break;
      }
      case 'dynamiczone':
        (Array.isArray(value) ? value : []).forEach((item, index) => {
          // Stored items name their component by stable ID.
          const component = isRecord(item) ? componentOf(model, item[COMPONENT_KEY]) : undefined;
          if (component && isRecord(item)) {
            collect(model, component.fields, item, pointer(path, index), add);
          }
        });
        break;
      default:
        break;
    }
  }
};

/** Every asset a stored document shows, with its per-use alt text, in document order. */
export const imageUsesOf = (model: ContentModel, data: Readonly<ContentData>): ImageUse[] => {
  const uses: ImageUse[] = [];
  const seen = new Map<string, number>();
  collect(model, model.definition.fields, data, '', (path, assetId, alt) => {
    const key = `${path}|${assetId}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    uses.push({ path, assetId, alt, occurrence });
  });
  return uses;
};
