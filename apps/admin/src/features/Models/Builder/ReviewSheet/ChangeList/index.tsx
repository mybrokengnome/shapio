import type { ClassifiedChange, SchemaDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { PLAN_BUCKET_LABEL_KEYS } from '../../../constants';
import { describeChange } from '../../../helpers/describeChange';
import { groupByBucket } from '../../../helpers/planBuckets';
import { BucketChip } from '../../BucketChip';

type ChangeListProps = {
  changes: readonly ClassifiedChange[];
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
};

/** Every change in the plan, grouped by how it is applied, most demanding group first. */
export const ChangeList = ({ changes, before, after }: ChangeListProps) => {
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
            {inGroup.map((change, index) => (
              <li
                key={`${change.kind}-${change.fieldId ?? ''}-${change.property ?? ''}-${index}`}
                className="px-3 py-2.5 text-sm"
              >
                {describeChange(change, before, after)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
