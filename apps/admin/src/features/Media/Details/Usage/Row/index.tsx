import type { MediaUsage } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { entryLink } from '@/features/Inbox/helpers/entryLink';

type RowProps = {
  usage: MediaUsage;
  /** The entry's model, when the admin may read it; without it the entry is named but not linked. */
  model: ModelDefinition | undefined;
};

/** One entry version using the asset: its title linking to the entry in that locale, the type, locale and state. */
export const Row = ({ usage, model }: RowProps) => {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        {model ? (
          <>
            <RowTitle asChild className="block truncate text-sm">
              <Link {...entryLink(model.apiKey, usage.entryId, model.kind, { locale: usage.locale })}>
                {usage.title ?? t('content.untitled')}
              </Link>
            </RowTitle>
            <p className="truncate text-meta text-muted-foreground">{model.label}</p>
          </>
        ) : (
          <p className="truncate text-sm text-muted-foreground">{t('media.usage.hidden')}</p>
        )}
      </div>
      <Badge variant="outline" className="font-mono">
        {usage.locale}
      </Badge>
      <StatusChip
        size="sm"
        tone={usage.state === 'published' ? 'success' : 'neutral'}
        label={usage.state === 'published' ? t('media.usage.published') : t('media.usage.draft')}
      />
    </li>
  );
};
