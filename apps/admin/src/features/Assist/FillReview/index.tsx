import type { ContentOpsSkip, FieldFillResult } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ASSIST_FILL_SCAN_LIMIT } from '@/constants/assist';
import { findModelByKey, useContentSchema } from '@/features/Content/hooks/useContentSchema';
import { describeAssistErrorCode } from '@/helpers/describeAssistError';
import { isKnownSkipReason, SKIP_REASON_KEYS } from '../constants';
import { fillGroupsOf } from '../helpers/fillGroups';
import type { FieldFill } from '../hooks/useFieldFill';
import { Group } from './Group';

type FillReviewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The model that proposed the values. */
  model: string;
  result: FieldFillResult;
  fill: FieldFill;
};

/**
 * Proposed values for empty fields, one group per entry locale: edit them, reject some, and Accept saves
 * the rest into the entry's draft and the run's change set. Nothing goes live until that set ships.
 */
export const FillReview = ({ open, onOpenChange, model, result, fill }: FillReviewProps) => {
  const { t } = useTranslation();
  const { schema } = useContentSchema();
  const groups = useMemo(() => fillGroupsOf(result.proposals), [result.proposals]);
  const skipReason = (skip: ContentOpsSkip) =>
    isKnownSkipReason(skip.reason) ? t(SKIP_REASON_KEYS[skip.reason]) : describeAssistErrorCode(skip.reason);
  const reasons = [...new Set(result.skipped.map(skipReason))];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>{t('assist.fill.title')}</SheetTitle>
          <SheetDescription>{t('assist.fill.description', { model })}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {groups.length === 0 ? (
            <EmptyState size="panel" icon={CircleCheck} title={t('assist.fill.none')} />
          ) : (
            <ul aria-label={t('assist.fill.title')} className="divide-y">
              {groups.map((group) => (
                <Group
                  key={group.key}
                  group={group}
                  fill={fill}
                  model={schema ? findModelByKey(schema, group.modelKey) : undefined}
                />
              ))}
            </ul>
          )}
          {result.skipped.length > 0 ? (
            <p className="flex items-center gap-1 text-meta text-muted-foreground">
              {t('assist.fixes.skipped', { count: result.skipped.length })}
              <InfoHint about={t('assist.fill.skippedAbout')}>
                <span className="block space-y-1">
                  {reasons.map((reason) => (
                    <span key={reason} className="block">
                      {reason}
                    </span>
                  ))}
                </span>
              </InfoHint>
            </p>
          ) : null}
          {result.scanCapped ? (
            <p className="text-meta text-muted-foreground">
              {t('assist.fill.scanCapped', {
                count: ASSIST_FILL_SCAN_LIMIT,
                limit: ASSIST_FILL_SCAN_LIMIT.toLocaleString(),
              })}
            </p>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          {fill.changeSetId ? (
            <Button asChild>
              <Link to="/changes/$changeSetId" params={{ changeSetId: fill.changeSetId }}>
                {t('assist.fill.openChangeSet')}
              </Link>
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
