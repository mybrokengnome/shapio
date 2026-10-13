import type { DefinitionCategory, DefinitionScope } from '@shapio/client';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { InfoHint } from '@/components/InfoHint';
import { InlineConfirm } from '@/components/InlineConfirm';
import { SharedGlyph } from '@/components/SharedGlyph';
import { Button } from '@/components/ui/button';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { useScopeChange } from '../../hooks/useScopeChange';
import { PanelSection } from '../../PanelSection';

type ScopeProps = {
  category: DefinitionCategory;
  id: string;
  label: string;
  scope: DefinitionScope;
  /** Unsaved edits or a change still running: the scope can't change until they are saved or discarded. */
  blocked: boolean;
  /** The schema lock is on (its notice says why). */
  locked: boolean;
  /** The definition moved since the draft loaded: the builder shows its reload banner. */
  onConflict: () => void;
  /**
   * The type this one extends: a kind lives where its family does, so only the family's root moves (the
   * action is off here, with a note naming the parent).
   */
  parentLabel?: string;
  /** Kinds below this type (all levels): they move with it. */
  kindCount: number;
};

/**
 * "Available on": this site or all sites, and for admins with `schema.create` on every site the action that
 * moves it (confirmed in place). Shown only where there is more than one site.
 */
export const Scope = ({
  category,
  id,
  label,
  scope,
  blocked,
  locked,
  onConflict,
  parentLabel,
  kindCount,
}: ScopeProps) => {
  const { t } = useTranslation();
  const site = useMe().data?.site;
  const { canShare } = useSchemaScopeAccess();
  const change = useScopeChange(category, id, onConflict);
  const hintId = useId();
  const kindNoteId = useId();
  const shared = scope === 'network';
  const target: DefinitionScope = shared ? 'site' : 'network';
  const siteName = site?.name ?? '';
  const isKind = parentLabel !== undefined;
  const description = shared ? t('models.scope.keepDescription') : t('models.scope.shareDescription');
  // A root moves with its whole family (one change); say so when it has kinds.
  const familyNote = kindCount > 0 ? ` ${t('models.inheritance.scopeCascades', { count: kindCount })}` : '';
  return (
    <PanelSection title={t('contentTypes.availableOn')}>
      <p className="flex items-center gap-1.5 text-sm" data-scope={scope}>
        {shared ? <SharedGlyph /> : null}
        {shared ? t('contentTypes.sharedWithAllSites') : t('models.scope.onlyOn', { site: siteName })}
      </p>
      {canShare && isKind ? (
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="sm" disabled aria-describedby={kindNoteId}>
            {shared ? t('models.scope.keep') : t('models.scope.share')}
          </Button>
          <p id={kindNoteId} className="text-meta text-muted-foreground">
            {t('models.inheritance.scopeFollowsParent', { model: parentLabel })}
          </p>
        </div>
      ) : null}
      {canShare && !isKind ? (
        <div className="flex items-center gap-1">
          <InlineConfirm
            tone="default"
            title={
              shared
                ? t('models.scope.keepTitle', { label, site: siteName })
                : t('models.scope.shareTitle', { label })
            }
            description={`${description}${familyNote}`}
            confirmLabel={shared ? t('models.scope.keep') : t('models.scope.share')}
            pendingLabel={t('common.saving')}
            onConfirm={() => change(target)}
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={blocked || locked}
                aria-describedby={blocked ? hintId : undefined}
              >
                {shared ? t('models.scope.keep') : t('models.scope.share')}
              </Button>
            }
          />
          {blocked ? (
            <InfoHint about={shared ? t('models.scope.keep') : t('models.scope.share')} id={hintId}>
              {t('models.scope.blocked')}
            </InfoHint>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  );
};
