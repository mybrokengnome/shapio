import type { ChangeSet, ChangeSetReview } from '@shapio/client';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useScheduleChangeSet, useShipChangeSet, useUpdateChangeSet } from '@/api/changeSets';
import { hasErrorCode } from '@/api/errors';
import { EDITABLE_STATUSES } from '../../Changes/constants';

/**
 * Shipping a reviewed set (plan developer-face §5): breaking and destructive changes must be acknowledged,
 * and an interactive ship is strict: it sends the set version and the entry draft versions this review
 * showed, so anything that moved since makes the server refuse (409) and the page shows "changed since you
 * looked" with Refresh. The acknowledgements reset whenever a new review loads.
 */
/** A draft moved (CHANGE_SET_STALE) or the set itself changed (VERSION_CONFLICT) after the review loaded. */
const isStale = (error: unknown) =>
  hasErrorCode(error, 'CHANGE_SET_STALE') || hasErrorCode(error, 'VERSION_CONFLICT');

export const useShipFlow = (set: ChangeSet, review: UseQueryResult<ChangeSetReview>) => {
  const { t } = useTranslation();
  const ship = useShipChangeSet();
  const schedule = useScheduleChangeSet();
  const update = useUpdateChangeSet();
  const [acknowledgedBreaking, setAcknowledgedBreaking] = useState(false);
  const [acknowledgedDestructive, setAcknowledgedDestructive] = useState(false);
  const [refusedStale, setRefusedStale] = useState(false);
  /** The failure the admin already refreshed after (its `updatedAt`), so it stops reading as stale. */
  const [refreshedFailure, setRefreshedFailure] = useState<string | null>(null);
  // A ship with prerequisites runs in the background and checks the drafts at the end: a moved draft
  // fails the set with CHANGE_SET_STALE instead of refusing the request.
  const failedStale =
    set.status === 'failed' && set.error?.code === 'CHANGE_SET_STALE' && refreshedFailure !== set.updatedAt;
  const stale = refusedStale || failedStale;
  const [reviewedAt, setReviewedAt] = useState(review.dataUpdatedAt);
  if (review.dataUpdatedAt !== reviewedAt) {
    setReviewedAt(review.dataUpdatedAt);
    setAcknowledgedBreaking(false);
    setAcknowledgedDestructive(false);
  }

  const data = review.data;
  const checks = data?.checks;
  const needsBreaking = checks?.breaking ?? false;
  const needsDestructive = checks?.destructive ?? false;
  const acknowledged =
    (!needsBreaking || acknowledgedBreaking) && (!needsDestructive || acknowledgedDestructive);
  const itemCount = set.entryItemCount + set.schemaItemCount;
  const blocked = (checks?.blocking.length ?? 0) > 0;
  const canShip =
    EDITABLE_STATUSES.has(set.status) && data !== undefined && itemCount > 0 && !blocked && !stale;
  const acknowledgement = {
    ...(needsBreaking ? { acknowledgeBreaking: true } : {}),
    ...(needsDestructive ? { acknowledgeDestructive: true } : {}),
  };

  /** Runs a write that checks what the review saw; a stale answer turns into the banner instead of an error. */
  const strict = async (write: () => Promise<unknown>) => {
    try {
      await write();
    } catch (error) {
      // CHANGE_SET_STALE (a draft moved) or a stale set version: both mean "changed since you looked".
      if (isStale(error)) {
        setRefusedStale(true);
        return;
      }
      throw error;
    }
  };

  const shipNow = (deploymentConnectionId?: string | null) =>
    strict(async () => {
      if (!data) {
        return;
      }
      let expectedVersion = data.changeSet.version;
      if (deploymentConnectionId !== undefined && deploymentConnectionId !== set.deploymentConnectionId) {
        const updated = await update.mutateAsync({
          id: set.id,
          input: { deploymentConnectionId, expectedVersion },
        });
        expectedVersion = updated.version;
      }
      const result = await ship.mutateAsync({
        id: set.id,
        input: {
          expectedVersion,
          ...acknowledgement,
          itemVersions: data.entries.flatMap((entry) =>
            entry.draftVersion === null ? [] : [{ itemId: entry.itemId, draftVersion: entry.draftVersion }],
          ),
        },
      });
      if (result.status === 'shipped') {
        toast.success(t('changes.review.shipped', { seq: result.shippedSnapshot ?? '' }));
      } else if (result.status === 'shipping') {
        toast.info(t('changes.review.shippingStarted'));
      } else {
        toast.error(t('changes.review.shipFailed'));
      }
    });

  const scheduleAt = (at: string) =>
    strict(async () => {
      if (!data) {
        return;
      }
      await schedule.mutateAsync({
        id: set.id,
        input: { at, expectedVersion: data.changeSet.version, ...acknowledgement },
      });
      toast.success(t('changes.review.scheduled'));
    });

  return {
    needsBreaking,
    needsDestructive,
    acknowledgedBreaking,
    acknowledgedDestructive,
    setAcknowledgedBreaking,
    setAcknowledgedDestructive,
    acknowledged,
    canShip,
    shipping: ship.isPending || update.isPending,
    shipNow,
    scheduleAt,
    scheduleError: schedule.error,
    resetSchedule: schedule.reset,
    scheduling: schedule.isPending,
    stale,
    refresh: async () => {
      // The banner goes only once the new review is in: it resets the acknowledgements when it lands.
      await review.refetch();
      setRefusedStale(false);
      setRefreshedFailure(set.updatedAt);
    },
  };
};

export type ShipFlow = ReturnType<typeof useShipFlow>;
