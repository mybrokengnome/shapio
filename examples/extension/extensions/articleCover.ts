import type { BeforeHook } from '@shapio/cms/config';

/**
 * An article cannot go live without a cover image. Runs inside the publish transaction (REST, GraphQL,
 * scheduled and release publishes alike); rejecting answers 422 HOOK_REJECTED and nothing is published.
 */
export const requireArticleCover: BeforeHook = ({ data, reject }) => {
  if (!data?.cover) {
    reject('An article needs a cover image before it can be published', { field: 'cover' });
  }
};
