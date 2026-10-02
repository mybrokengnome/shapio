import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../ConfirmDialog';

/** A navigation the guard may let through: the pathnames it goes from and to. */
export type GuardedNavigation = { currentPath: string; nextPath: string };

type UnsavedChangesGuardProps = {
  when: boolean;
  /**
   * While `when`, which navigations ask (default: all). E.g. a screen whose edits survive a search-param
   * change asks only when the path changes. Reloading or closing the page always warns.
   */
  shouldBlock?: (navigation: GuardedNavigation) => boolean;
  /** The question; defaults to "Discard unsaved changes?" (and its description and buttons). */
  title?: string;
  description?: string;
  /** The button that stays on the page. */
  stayLabel?: string;
  /** The button that leaves. */
  leaveLabel?: string;
};

/**
 * Dirty-state protection: while `when` is true, in-app navigation asks before discarding edits and the
 * browser warns on reload/close.
 */
export const UnsavedChangesGuard = ({
  when,
  shouldBlock,
  title,
  description,
  stayLabel,
  leaveLabel,
}: UnsavedChangesGuardProps) => {
  const { t } = useTranslation();
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      when && (shouldBlock?.({ currentPath: current.pathname, nextPath: next.pathname }) ?? true),
    enableBeforeUnload: () => when,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.status === 'blocked') {
          blocker.reset();
        }
      }}
      title={title ?? t('unsaved.title')}
      description={description ?? t('unsaved.description')}
      cancelLabel={stayLabel ?? t('unsaved.stay')}
      confirmLabel={leaveLabel ?? t('unsaved.leave')}
      destructive
      onConfirm={() => blocker.proceed?.()}
    />
  );
};
