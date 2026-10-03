'use client';
import { stringsFor } from '../../lib/site';
import { ArticleView } from '../ArticleView';
import { Sections } from '../Sections';
import { usePreviewDraft } from './hooks/usePreviewDraft';

/** A draft page or article, rendered in the browser with the published pages' components. */
export const Preview = () => {
  const state = usePreviewDraft();
  const strings = stringsFor(state.locale);
  return (
    <>
      <div className="preview-banner" role="status">
        {strings.previewBanner}
      </div>
      <main id="content" lang={state.locale}>
        {state.status === 'loading' ? <p>{strings.previewLoading}</p> : null}
        {state.status === 'incomplete' ? <p>{strings.previewIncomplete}</p> : null}
        {state.status === 'failed' ? (
          <p>
            {strings.previewFailed}: {state.message}
          </p>
        ) : null}
        {state.status === 'ready' && state.draft.modelKey === 'pages' ? (
          <Sections page={state.draft.entry} />
        ) : null}
        {state.status === 'ready' && state.draft.modelKey === 'articles' ? (
          <ArticleView article={state.draft.entry} locale={state.locale} strings={strings} />
        ) : null}
      </main>
    </>
  );
};
