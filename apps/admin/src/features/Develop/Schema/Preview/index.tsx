import type { SchemaDefinition } from '@shapio/schema';
import { FileWarning } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FileAnalysis } from '../helpers/analyze';
import type { SchemaFile } from '../helpers/files';
import { FormPreview } from './FormPreview';
import { GraphqlShape } from './GraphqlShape';
import { Plan } from './Plan';
import { RestShape } from './RestShape';
import { Types } from './Types';

const PREVIEW_TABS = ['form', 'rest', 'graphql', 'types', 'plan'] as const;
type PreviewTab = (typeof PREVIEW_TABS)[number];

const TAB_LABEL_KEYS = {
  form: 'develop.schema.preview.tabs.form',
  rest: 'develop.schema.preview.tabs.rest',
  graphql: 'develop.schema.preview.tabs.graphql',
  types: 'develop.schema.preview.tabs.types',
  plan: 'develop.schema.preview.tabs.plan',
} as const satisfies Record<PreviewTab, string>;

type PreviewProps = {
  file: SchemaFile;
  analysis: FileAnalysis | undefined;
  edited: boolean;
  definitions: readonly SchemaDefinition[];
};

/** What the open file produces: the entry form, the REST and GraphQL shapes, the types and the plan. */
export const Preview = ({ file, analysis, edited, definitions }: PreviewProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PreviewTab>('form');
  const definition = analysis?.status === 'valid' ? analysis.definition : undefined;
  const lookup = useMemo(
    () =>
      new Map(
        [
          ...definitions.filter((other) => other.id !== file.definitionId),
          ...(definition ? [definition] : []),
        ].map((entry) => [entry.id, entry]),
      ),
    [definitions, definition, file.definitionId],
  );
  const invalid = (
    <EmptyState
      size="panel"
      icon={FileWarning}
      title={t('develop.schema.preview.invalidTitle')}
      description={t('develop.schema.preview.invalidDescription')}
    />
  );
  return (
    <Panel title={t('develop.schema.preview.title')} titleAs="h2">
      <Tabs value={tab} onValueChange={(value) => setTab(value as PreviewTab)}>
        <TabsList variant="underline" className="w-full justify-start overflow-x-auto">
          {PREVIEW_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(TAB_LABEL_KEYS[value])}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="form" className="pt-4">
          {definition ? <FormPreview definition={definition} definitions={definitions} /> : invalid}
        </TabsContent>
        <TabsContent value="rest" className="pt-4">
          {definition ? <RestShape definition={definition} lookup={lookup} /> : invalid}
        </TabsContent>
        <TabsContent value="graphql" className="pt-4">
          {definition ? <GraphqlShape definition={definition} lookup={lookup} /> : invalid}
        </TabsContent>
        <TabsContent value="types" className="pt-4">
          <Types apiKey={file.apiKey} edited={edited} />
        </TabsContent>
        <TabsContent value="plan" className="pt-4">
          {definition ? <Plan before={file.base.definition} after={definition} /> : invalid}
        </TabsContent>
      </Tabs>
    </Panel>
  );
};
