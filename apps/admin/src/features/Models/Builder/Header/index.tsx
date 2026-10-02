import { routeKeyOf, type SchemaDefinition } from '@shapio/schema';
import { linkOptions, useParams } from '@tanstack/react-router';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SaveActions, type SaveActionsProps } from '../SaveActions';

type HeaderProps = SaveActionsProps & {
  draft: SchemaDefinition;
  version: number;
  dirty: boolean;
  issueCount: number;
  /** Deleting is not possible right now (locked, a change running). */
  deleteBlocked: boolean;
  onDelete: () => void;
};

/** Breadcrumb, title with the draft's state, API IDs and version, and the save actions (xl and up). */
export const Header = ({
  draft,
  version,
  dirty,
  issueCount,
  deleteBlocked,
  onDelete,
  ...saveActions
}: HeaderProps) => {
  const { t } = useTranslation();
  // The place this builder is the Structure tab of (its saved API ID, from the URL), or Components.
  const { modelKey = draft.apiKey } = useParams({ strict: false });
  const breadcrumb =
    draft.kind === 'component'
      ? [{ label: t('shell.nav.components'), link: linkOptions({ to: '/develop/components' }) }]
      : [
          { label: draft.label, link: linkOptions({ to: '/content/$modelKey', params: { modelKey } }) },
          { label: t('place.tabs.structure') },
        ];
  return (
    <PageHeader
      sticky
      breadcrumb={breadcrumb}
      title={draft.label || t('models.builder.untitled')}
      badge={
        dirty || issueCount > 0 ? (
          <span className="flex flex-wrap items-center gap-2">
            {dirty ? <StatusChip tone="warning" label={t('models.builder.unsaved')} /> : null}
            {issueCount > 0 ? (
              <StatusChip tone="danger" label={t('models.builder.problems', { count: issueCount })} />
            ) : null}
          </span>
        ) : null
      }
      meta={
        draft.kind === 'collection'
          ? t('models.builder.subtitleCollection', {
              apiKey: draft.apiKey,
              pluralApiKey: routeKeyOf(draft),
              version,
            })
          : t('models.builder.subtitle', { apiKey: draft.apiKey, version })
      }
      actions={
        <>
          <div className="hidden items-center gap-2 xl:flex">
            <SaveActions {...saveActions} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('models.builder.more')}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" disabled={deleteBlocked} onSelect={onDelete}>
                <Trash2 aria-hidden="true" />
                {t('models.builder.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
};
