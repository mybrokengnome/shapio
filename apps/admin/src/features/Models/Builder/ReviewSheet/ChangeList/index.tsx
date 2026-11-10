import type { LensEffect } from '@shapio/client';
import type { ClassifiedChange, SchemaDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { PLAN_BUCKET_LABEL_KEYS } from '../../../constants';
import { describeChange } from '../../../helpers/describeChange';
import { groupByBucket } from '../../../helpers/planBuckets';
import { BucketChip } from '../../BucketChip';
import { OlderClientsLine } from '../OlderClientsLine';

type ChangeListProps = {
  changes: readonly ClassifiedChange[];
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  /** A model's name by ID (a parent named in a re-parent, an interface in Implements). */
  definitionName?: (id: string) => string | undefined;
  /** For an interface: how many types implement it. */
  memberCount?: number;
  /** What clients naming an older schema version see, for the changes that need a line. */
  olderClientsEffects?: ReadonlyMap<ClassifiedChange, LensEffect | null>;
};

/** Every change in the plan, grouped by how it is applied, most demanding group first. */
export const ChangeList = ({
  changes,
  before,
  after,
  definitionName,
  memberCount,
  olderClientsEffects,
}: ChangeListProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {groupByBucket(changes).map(({ bucket, changes: inGroup }) => (
        <div key={bucket} className="space-y-2">
          <div className="flex items-center gap-2">
            <BucketChip bucket={bucket} />
            <span className="text-meta text-muted-foreground tabular-nums">{inGroup.length}</span>
          </div>
          <ul aria-label={t(PLAN_BUCKET_LABEL_KEYS[bucket])} className="divide-y rounded-lg border">
            {inGroup.map((change, index) => {
              const olderClients = olderClientsEffects?.get(change);
              return (
                <li
                  key={`${change.kind}-${change.fieldId ?? ''}-${change.property ?? ''}-${index}`}
                  className="space-y-1 px-3 py-2.5 text-sm"
                >
                  <span className="block">
                    {describeChange(change, before, after, { definitionName, memberCount })}
                  </span>
                  {olderClients ? <OlderClientsLine effect={olderClients} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
};
