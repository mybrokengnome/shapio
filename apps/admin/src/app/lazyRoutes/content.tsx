import { createLazyRoute } from '@tanstack/react-router';
import { EntryEditor } from '@/features/Content/EntryEditor';
import { ContentHome } from '@/features/Content/Home';
import { NewEntry } from '@/features/Content/NewEntry';
import { Place } from '@/features/Content/Place';

/** Content screens (and the editors with Tiptap), loaded together on the first visit to Content. */
export const contentLazyRoutes = {
  home: createLazyRoute('/app/content')({ component: ContentHome }),
  model: createLazyRoute('/app/content/$modelKey')({ component: Place }),
  newEntry: createLazyRoute('/app/content/$modelKey/new')({ component: NewEntry }),
  entry: createLazyRoute('/app/content/$modelKey/$entryId')({ component: EntryEditor }),
};
