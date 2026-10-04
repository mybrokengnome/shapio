import type { ReviewSchemaItem } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { describeChange } from '@/features/Models/helpers/describeChange';
import { cn } from '@/helpers/cn';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { ClassificationChip } from '../ClassificationChip';
import { classOfChange, signOfChange } from '../helpers/classification';
import { useSchemaItemDefinitions } from '../hooks/useSchemaItemDefinitions';

const SIGN_CLASSES = {
  '+': 'text-success',
  '−': 'text-destructive',
  '~': 'text-muted-foreground',
} as const;

const OPERATION_KEYS = {
  create: 'changes.review.operations.create',
  update: 'changes.review.operations.update',
  delete: 'changes.review.operations.delete',
} as const;

type SchemaDiffCardProps = { changeSetId: string; item: ReviewSchemaItem };

/**
 * A schema item as a diff: one `+`/`−`/`~` line per planned change, each with its classification, and a
 * quiet badge when the definition is shared (shipping it affects every site).
 */
export const SchemaDiffCard = ({ changeSetId, item }: SchemaDiffCardProps) => {
  const { t } = useTranslation();
  const { before, after, shared } = useSchemaItemDefinitions(changeSetId, item);
  const { multiSite } = useSchemaScopeAccess();
  const changes = item.plan?.changes ?? [];
  const title = after?.label ?? before?.label ?? item.apiKey;
  return (
    <Panel
      title={title}
      titleAs="h3"
      flush
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(OPERATION_KEYS[item.operation])}</Badge>
          {multiSite && shared ? (
            <Badge variant="outline" data-shared>
              <Globe2 aria-hidden="true" />
              {t('changes.review.shared')}
            </Badge>
          ) : null}
          <span className="font-mono text-meta text-muted-foreground">{item.apiKey}</span>
        </div>
      }
    >
      {item.stale ? (
        <div className="border-b p-4">
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              {t('changes.review.schemaStale', {
                base: item.baseVersion ?? 0,
                active: item.activeVersion ?? 0,
              })}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {item.alsoChangedIn.length > 0 ? (
        <p className="border-b px-5 py-2.5 text-meta text-muted-foreground">
          {t('changes.review.alsoChangedIn')}{' '}
          {item.alsoChangedIn.map((other, index) => (
            <span key={other.id}>
              {index > 0 ? ', ' : ''}
              <Link
                to="/changes/$changeSetId"
                params={{ changeSetId: other.id }}
                className="text-link underline-offset-4 hover:underline"
              >
                {other.title}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <p className="px-5 py-4 text-meta text-muted-foreground">{t('changes.review.noSchemaChanges')}</p>
      ) : (
        <ul aria-label={t('changes.review.schemaChangesOf', { name: title })} className="divide-y text-sm">
          {changes.map((change, index) => {
            const sign = signOfChange(change);
            return (
              <li
                key={`${change.kind}-${change.fieldId ?? ''}-${change.property ?? ''}-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn('w-3 shrink-0 font-mono font-semibold', SIGN_CLASSES[sign])}
                >
                  {sign}
                </span>
                <span className="min-w-0 flex-1">{describeChange(change, before, after)}</span>
                <ClassificationChip changeClass={classOfChange(change)} size="sm" />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};
