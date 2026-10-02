import { suggestPlural, type DefinitionKind } from '@shapio/schema';
import { useTranslation } from 'react-i18next';

type EndpointPreviewProps = { apiKey: string; pluralApiKey: string; kind: DefinitionKind };

type PreviewRowProps = { label: string; names: string[] };

const PreviewRow = ({ label, names }: PreviewRowProps) => (
  <div className="flex min-w-0 items-baseline gap-2">
    <dt className="w-14 shrink-0">{label}</dt>
    <dd className="flex min-w-0 flex-wrap gap-1.5">
      {names.map((name) => (
        <code
          key={name}
          className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-foreground/80"
        >
          {name}
        </code>
      ))}
    </dd>
  </div>
);

/**
 * Every API name a model's API IDs produce (REST path, GraphQL queries), updated as they are typed, so it
 * is clear there is nothing else to configure. A collection is listed under its plural API ID
 * (`/api/content/articles`, `articles`) and read one by one under the singular (`article`). Nothing for
 * components or while the ID is empty.
 */
export const EndpointPreview = ({ apiKey, pluralApiKey, kind }: EndpointPreviewProps) => {
  const { t } = useTranslation();
  const id = apiKey.trim();
  if (id === '' || kind === 'component') {
    return null;
  }
  const plural = pluralApiKey.trim() || suggestPlural(id);
  const routeKey = kind === 'collection' ? plural : id;
  const graphqlNames = kind === 'collection' ? [id, plural] : [id];
  return (
    <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
      <PreviewRow label={t('models.restLabel')} names={[t('models.endpointPath', { routeKey })]} />
      <PreviewRow label={t('models.graphqlLabel')} names={graphqlNames} />
    </dl>
  );
};
