import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import type { VisualFocusMessage } from '@shapio/visual';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { EntryFormStore } from '@/fields/form/store';
import { resolvePreviewFocus } from '../helpers/focusTarget';

type PreviewFocusOptions = {
  entryId: string;
  locale: string | null;
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  store: EntryFormStore;
  /** Scrolls to a field and focuses its control (the document's reveal). */
  reveal: (path: string) => void;
};

/**
 * A click in the preview → the field it shows: focused in the document. A click on something of another entry
 * or locale, or on a path the model doesn't have, says so in a toast instead.
 */
export const usePreviewFocus = ({
  entryId,
  locale,
  model,
  components,
  store,
  reveal,
}: PreviewFocusOptions) => {
  const { t } = useTranslation();
  return useCallback(
    (message: VisualFocusMessage) => {
      const target = resolvePreviewFocus(message, {
        entryId,
        locale,
        model,
        components,
        values: store.getState().values,
      });
      if (target.kind === 'field') {
        reveal(target.path);
      } else if (target.kind === 'otherEntry') {
        toast.info(t('entry.preview.otherEntry'));
      } else if (target.kind === 'otherLocale') {
        toast.info(t('entry.preview.otherLocale', { locale: target.locale }));
      } else {
        toast.info(t('entry.preview.unknownField'));
      }
    },
    [entryId, locale, model, components, store, reveal, t],
  );
};
