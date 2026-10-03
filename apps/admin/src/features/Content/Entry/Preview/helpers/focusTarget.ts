import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import type { VisualFocusMessage } from '@shapio/visual';
import { resolveFieldPath } from '../../helpers/fieldPath';

/** What a click in the preview asks the document to do. */
export type PreviewFocus =
  | { kind: 'field'; path: string }
  | { kind: 'otherEntry' }
  | { kind: 'otherLocale'; locale: string }
  | { kind: 'unknownField' };

type OpenDocument = {
  entryId: string;
  /** The document's locale; null for a model that isn't localized. */
  locale: string | null;
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  values: Readonly<Record<string, unknown>>;
};

/**
 * Maps a clicked element (entry, API ID path, locale) to a field of the open document. Another entry (a
 * populated relation) or another locale is reported, not followed; a path that names no field of the model is
 * unknown.
 */
export const resolvePreviewFocus = (message: VisualFocusMessage, open: OpenDocument): PreviewFocus => {
  if (message.entryId !== open.entryId) {
    return { kind: 'otherEntry' };
  }
  if (open.locale !== null && message.locale !== undefined && message.locale !== open.locale) {
    return { kind: 'otherLocale', locale: message.locale };
  }
  return resolveFieldPath(open.model, open.components, open.values, message.path)
    ? { kind: 'field', path: message.path }
    : { kind: 'unknownField' };
};
