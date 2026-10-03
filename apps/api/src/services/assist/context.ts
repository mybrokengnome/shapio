import type { AssistRuntime } from '../../assist/runtime.js';
import type { MediaStorage } from '../../media/types.js';
import type { ContentServiceContext } from '../contentAccess.js';

export type { AssistRuntime } from '../../assist/runtime.js';

/** What an assist service call needs: the content context, the provider, media storage (vision). */
export type AssistServiceContext = ContentServiceContext & {
  assist: AssistRuntime;
  storage: MediaStorage;
  /** Aborted when the client goes away, so an abandoned request stops waiting for the model. */
  signal?: AbortSignal;
};
