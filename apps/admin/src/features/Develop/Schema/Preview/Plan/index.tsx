import { classifyChanges, diffDefinitions, summarizeChanges, type SchemaDefinition } from '@shapio/schema';
import { CircleCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BucketChip } from '@/features/Models/Builder/BucketChip';
import { describeChange } from '@/features/Models/helpers/describeChange';
import { groupByBucket } from '@/features/Models/helpers/planBuckets';

type PlanProps = { before: SchemaDefinition; after: SchemaDefinition };

/**
 * What applying the file would change, classified like the builder's review (`diffDefinitions` +
 * `classifyChanges` against the version the file was loaded from). The server plans it again, with the
 * content checks, in the change set's review.
 */
export const Plan = ({ before, after }: PlanProps) => {
  const { t } = useTranslation();
  const changes = useMemo(
    () => classifyChanges(diffDefinitions(before, after), { before, after }),
    [before, after],
  );
  if (changes.length === 0) {
    return <EmptyState size="panel" icon={CircleCheck} title={t('develop.schema.plan.none')} />;
  }
  const summary = summarizeChanges(changes);
  return (
    <div className="space-y-5">
      {summary.breaking || summary.destructive ? (
        <Alert variant="warning">
          <AlertDescription>
            {summary.destructive ? t('develop.schema.plan.destructive') : t('develop.schema.plan.breaking')}
          </AlertDescription>
        </Alert>
      ) : null}
      {!summary.supported ? (
        <Alert variant="destructive">
          <AlertDescription>{t('develop.schema.plan.unsupported')}</AlertDescription>
        </Alert>
      ) : null}
      {groupByBucket(changes).map((group) => (
        <div key={group.bucket} className="space-y-2">
          <BucketChip bucket={group.bucket} />
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {group.changes.map((change, index) => (
              <li key={`${change.kind}:${change.fieldId ?? ''}:${change.property ?? ''}:${index}`}>
                {describeChange(change, before, after)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-meta text-muted-foreground">{t('develop.schema.plan.serverChecks')}</p>
    </div>
  );
};
