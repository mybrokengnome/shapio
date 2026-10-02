import { Link } from '@tanstack/react-router';
import { Boxes, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { RowTitle } from '@/components/RowTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MODELS_PANEL_LIMIT } from '../constants';
import type { useModelSummaries } from '../hooks/useModelSummaries';

type ModelsProps = ReturnType<typeof useModelSummaries>;

const KIND_LABEL_KEYS = { collection: 'home.kinds.collection', singleton: 'home.kinds.singleton' } as const;

/** The first few content types with their kind and version, linking to their structure. */
export const Models = ({ query, models }: ModelsProps) => {
  const { t } = useTranslation();
  const canCreate = useHasGlobalPermission('schema.create');
  return (
    <Panel
      title={t('home.models')}
      flush
      actions={
        models && models.length > 0 ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/content">{t('home.allModels')}</Link>
          </Button>
        ) : null
      }
    >
      <QueryView
        query={query}
        loadingRows={3}
        isEmpty={() => models?.length === 0}
        empty={
          <EmptyState
            size="panel"
            icon={Boxes}
            title={t('home.noModels')}
            action={
              canCreate ? (
                <Button asChild>
                  <Link to="/content/new">
                    <Plus aria-hidden="true" />
                    {t('home.newModel')}
                  </Link>
                </Button>
              ) : null
            }
          />
        }
      >
        {() => (
          <ul className="divide-y">
            {models?.slice(0, MODELS_PANEL_LIMIT).map((model) => (
              <li key={model.id} className="flex h-11 items-center gap-3 px-5">
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <RowTitle asChild className="truncate">
                    <Link
                      to="/content/$modelKey"
                      params={{ modelKey: model.apiKey }}
                      search={{ tab: 'structure' }}
                    >
                      {model.label}
                    </Link>
                  </RowTitle>
                  <span className="truncate font-mono text-xs text-muted-foreground">{model.apiKey}</span>
                </span>
                <Badge variant="secondary">{t(KIND_LABEL_KEYS[model.kind])}</Badge>
                <span className="w-10 text-right text-meta text-muted-foreground tabular-nums">
                  {t('home.version', { version: model.version })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
};
