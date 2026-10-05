import { graphqlPlaygroundUrl } from '@/api/apiDocs';
import { useDeliverySiteKey } from '@/hooks/useDeliverySiteKey';
import { useResolvedScheme } from '@/hooks/useResolvedScheme';
import { playgroundUrl } from '../helpers/playgroundUrl';

/** GraphiQL's URL for this page's site, in the admin's scheme, opened on `query` when given. */
export const usePlaygroundUrl = (query: string | undefined) => {
  const siteKey = useDeliverySiteKey();
  const theme = useResolvedScheme();
  return playgroundUrl(graphqlPlaygroundUrl(), { siteKey, query, theme });
};
