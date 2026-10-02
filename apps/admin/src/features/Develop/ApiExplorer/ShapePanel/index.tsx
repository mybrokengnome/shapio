import type { FieldUsageResponse } from '@shapio/client';
import type { DataType, ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { USAGE_DAYS } from '@/api/usage';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFieldUsage } from '../hooks/useFieldUsage';

const FLAG_KEYS = {
  required: 'develop.api.shape.flags.required',
  localized: 'develop.api.shape.flags.localized',
  private: 'develop.api.shape.flags.private',
  unique: 'develop.api.shape.flags.unique',
  filterable: 'develop.api.shape.flags.filterable',
  sortable: 'develop.api.shape.flags.sortable',
} as const;

type Flag = keyof typeof FLAG_KEYS;

const flagsOf = (field: ModelDefinition['fields'][number]): Flag[] =>
  [
    field.required && 'required',
    field.localized && 'localized',
    !field.public && 'private',
    field.unique && 'unique',
    field.filterable && 'filterable',
    field.sortable && 'sortable',
  ].filter((flag): flag is Flag => flag !== false);

/** Reads of a top-level field and its readers' names (tokens by name), most reads first. */
const readsOf = (usage: FieldUsageResponse | undefined, apiKey: string) => {
  const field = usage?.fields.find((candidate) => candidate.apiKeyPath === apiKey);
  return field ? { reads: field.reads, readers: field.principals } : undefined;
};

type ShapePanelProps = { model: ModelDefinition };

/**
 * The fields the endpoint returns, with their types and flags from the registry and who reads them
 * (delivery usage over the last days, when the admin may see it).
 */
export const ShapePanel = ({ model }: ShapePanelProps) => {
  const { t } = useTranslation();
  const usage = useFieldUsage(model.id);
  const readerName = (principalKey: string, tokenName: string | undefined) =>
    tokenName ??
    (principalKey === 'anonymous' ? t('develop.api.shape.anonymous') : t('develop.api.shape.appUsers'));
  const fields = model.fields.filter((field) => !field.deprecated);
  return (
    <Panel
      title={t('develop.api.shape.title')}
      description={t('develop.api.shape.description', { model: model.label, days: USAGE_DAYS })}
      flush
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('develop.api.shape.field')}</TableHead>
            <TableHead>{t('develop.api.shape.readers')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field) => {
            const reads = readsOf(usage.data, field.apiKey);
            return (
              <TableRow key={field.id}>
                <TableCell className="h-auto py-2 align-top">
                  <p className="font-mono text-xs font-semibold">{field.apiKey}</p>
                  <p className="text-meta text-muted-foreground">
                    {t(`models.dataTypes.${field.type satisfies DataType}.name`)}
                  </p>
                  {flagsOf(field).length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {flagsOf(field).map((flag) => (
                        <Badge key={flag} variant="outline" className="text-2xs">
                          {t(FLAG_KEYS[flag])}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="h-auto py-2 align-top text-meta">
                  {reads ? (
                    <>
                      <p className="tabular-nums">{t('develop.api.shape.reads', { count: reads.reads })}</p>
                      <p className="text-muted-foreground">
                        {reads.readers
                          .map((reader) => readerName(reader.principalKey, reader.tokenName))
                          .join(', ')}
                      </p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {usage.isPending
                        ? t('common.loading')
                        : usage.data?.tracking === false
                          ? t('develop.api.shape.trackingOff')
                          : t('develop.api.shape.noReads')}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
};
