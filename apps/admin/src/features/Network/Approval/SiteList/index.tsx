import type { NetworkApproval } from '@shapio/client';
import { useTranslation } from 'react-i18next';

type SiteListProps = { sites: NetworkApproval['sites'] };

/** Which sites follow the default: how many inherit it, and which have their own workflow or approval off. */
export const SiteList = ({ sites }: SiteListProps) => {
  const { t, i18n } = useTranslation();
  const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
  const names = (refs: ReadonlyArray<{ name: string }>) => list.format(refs.map((site) => site.name));
  return (
    <ul className="space-y-1 text-meta text-muted-foreground">
      <li>{t('approval.network.inheriting', { count: sites.inheriting })}</li>
      {sites.custom.length > 0 ? (
        <li>{t('approval.network.customSites', { sites: names(sites.custom) })}</li>
      ) : null}
      {sites.off.length > 0 ? <li>{t('approval.network.offSites', { sites: names(sites.off) })}</li> : null}
    </ul>
  );
};
