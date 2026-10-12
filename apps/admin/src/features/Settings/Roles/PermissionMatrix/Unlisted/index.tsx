import type { ContentAction } from '@shapio/client';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ACTION_COLUMN_KEYS } from '../constants';
import { unlistedGrants, type MatrixRules, type PermissionMatrix } from '../helpers/permissionMatrix';

type UnlistedProps<A extends ContentAction> = {
  matrix: PermissionMatrix<A>;
  /** The rows the table shows (the every-model row and every site's models). */
  listedKeys: ReadonlySet<string>;
  rules: MatrixRules<A>;
  readOnly: boolean;
  onRemove: (modelId: string, action: A) => void;
};

/**
 * Grants on models no site has any more (a deleted model keeps its grants), as stored: the server refuses
 * to save them, so each can be removed here.
 */
export const Unlisted = <A extends ContentAction>({
  matrix,
  listedKeys,
  rules,
  readOnly,
  onRemove,
}: UnlistedProps<A>) => {
  const { t } = useTranslation();
  const grants = unlistedGrants(matrix, listedKeys, rules);
  if (grants.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="unlisted-grants-title" className="space-y-3 border-t px-5 py-4">
      <h3 id="unlisted-grants-title" className="text-sm font-semibold">
        {t('roles.matrix.unlistedTitle')}
      </h3>
      <ul className="space-y-2">
        {grants.map(({ modelId, action, grant }) => {
          const actionLabel = t(ACTION_COLUMN_KEYS[action]);
          return (
            <li key={`${modelId}:${action}`} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm">
                <span className="font-semibold">{actionLabel}</span>{' '}
                <span className="font-mono text-xs break-all text-muted-foreground">{modelId}</span>
                {grant.ownOnly ? (
                  <span className="block text-meta text-muted-foreground">{t('roles.matrix.ownOnly')}</span>
                ) : null}
                {grant.fieldIds === null ? null : (
                  <span className="block text-meta text-muted-foreground">
                    {t('roles.matrix.fixedFields', { fields: grant.fieldIds.join(', ') || '–' })}
                  </span>
                )}
              </span>
              {readOnly ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t('roles.matrix.removeGrant', { action: actionLabel, model: modelId })}
                  onClick={() => onRemove(modelId, action)}
                >
                  <X aria-hidden="true" />
                  {t('common.remove')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
