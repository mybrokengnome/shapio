import type { FieldDefinition } from '@shapio/schema';
import type { ContentData } from '../db/contentData.js';
import type { ContentModel } from './model.js';
import { richTextMediaIds, type RichTextDocument } from './richtext/validate.js';
import { COMPONENT_KEY } from './validator/index.js';

/**
 * Media a document uses: media field values and rich-text images, also inside components and dynamic zones.
 * Each use is attributed to the top-level field that holds it (package G's `media_references` rows).
 */
export type MediaUse = { assetId: string; fieldId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const collect = (
  model: ContentModel,
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  add: (assetId: string) => void,
) => {
  for (const field of fields) {
    const value = data[field.id];
    if (value === undefined || value === null) {
      continue;
    }
    switch (field.type) {
      case 'media':
        (Array.isArray(value) ? value : [value]).forEach((id) => typeof id === 'string' && add(id));
        break;
      case 'richtext':
        if (isRecord(value) && isRecord(value.doc)) {
          richTextMediaIds(value as RichTextDocument).forEach(add);
        }
        break;
      case 'component': {
        const component = model.components.get(field.settings.component)?.definition;
        for (const item of Array.isArray(value) ? value : [value]) {
          if (component && isRecord(item)) {
            collect(model, component.fields, item, add);
          }
        }
        break;
      }
      case 'dynamiczone':
        for (const item of Array.isArray(value) ? value : []) {
          const component = isRecord(item)
            ? model.components.get(String(item[COMPONENT_KEY]))?.definition
            : undefined;
          if (component && isRecord(item)) {
            collect(model, component.fields, item, add);
          }
        }
        break;
      default:
        break;
    }
  }
};

/** Every (asset, top-level field) pair a document uses, without repeats. */
export const mediaUsesOf = (model: ContentModel, data: Readonly<ContentData>): MediaUse[] => {
  const uses = new Map<string, MediaUse>();
  for (const field of model.definition.fields) {
    collect(model, [field], data, (assetId) =>
      uses.set(`${assetId}|${field.id}`, { assetId, fieldId: field.id }),
    );
  }
  return [...uses.values()];
};

/** Asset IDs used by the given top-level fields of the documents. */
export const mediaIdsOf = (
  model: ContentModel,
  documents: readonly Readonly<ContentData>[],
  fields: readonly FieldDefinition[],
): Set<string> => {
  const ids = new Set<string>();
  for (const data of documents) {
    collect(model, fields, data, (id) => ids.add(id));
  }
  return ids;
};

/** The `allowedKinds` family of a MIME type. */
export const mediaKindOf = (mimeType: string): string => {
  const [type = '', subtype = ''] = mimeType.toLowerCase().split('/');
  if (type === 'image' || type === 'video' || type === 'audio') {
    return type;
  }
  if (type === 'text' || subtype === 'pdf' || /(msword|officedocument|opendocument|rtf|epub)/.test(subtype)) {
    return 'document';
  }
  return 'other';
};
