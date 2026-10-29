import { useTranslation } from 'react-i18next';
import { useNetworkApproval } from '@/api/networkApproval';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { DefaultForm } from './DefaultForm';

/** Network → Approval (`sites.manage`): the approval workflow every site inherits unless it chooses otherwise. */
export const Approval = () => {
  const { t } = useTranslation();
  const approval = useNetworkApproval();
  return (
    <Page width="narrow">
      <PageHeader title={t('approval.title')} />
      <QueryView query={approval} loadingRows={4}>
        {(data) => <DefaultForm key={data.version} approval={data} />}
      </QueryView>
    </Page>
  );
};
