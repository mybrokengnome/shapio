import { useMe } from '@/api/auth';

/** The key delivery requests name this site by (`?site=`); undefined on the primary site, which needs none. */
export const useDeliverySiteKey = () => {
  const site = useMe().data?.site;
  return site && !site.isPrimary ? site.key : undefined;
};
