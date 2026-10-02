import { useTranslation } from 'react-i18next';
import { CodeBlock } from '@/components/CodeBlock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { curlSnippet, fetchSnippet } from '../helpers/request';

type SnippetsProps = { url: string; withToken: boolean };

/** The request as curl and fetch, to copy (the token appears as `$SHAPIO_TOKEN`, never its value). */
export const Snippets = ({ url, withToken }: SnippetsProps) => {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="curl">
      <TabsList aria-label={t('develop.api.copyAs')} className="self-start">
        <TabsTrigger value="curl">{t('develop.api.curl')}</TabsTrigger>
        <TabsTrigger value="fetch">{t('develop.api.fetch')}</TabsTrigger>
      </TabsList>
      <TabsContent value="curl">
        <CodeBlock label={t('develop.api.curlLabel')} code={curlSnippet(url, withToken)} />
      </TabsContent>
      <TabsContent value="fetch">
        <CodeBlock label={t('develop.api.fetchLabel')} code={fetchSnippet(url, withToken)} />
      </TabsContent>
    </Tabs>
  );
};
