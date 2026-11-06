import { useSites } from '@/api/sites';

/** The site that is primary now (from the sites list); undefined while loading or when it is not listed. */
export const useCurrentPrimarySite = () => {
  const sites = useSites();
  return { primary: sites.data?.find((site) => site.isPrimary) };
};
