import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import {
  isProtectedEffect,
  OLDER_CLIENTS_LINE_KEYS,
  type OlderClientsLine as Line,
} from '../../../helpers/olderClients';

type OlderClientsLineProps = { effect: Line; className?: string };

/**
 * Under a breaking change: what it does to clients that name an older schema version (never loss an earlier
 * change caused; the Consumers tab shows that per reader).
 */
export const OlderClientsLine = ({ effect, className }: OlderClientsLineProps) => {
  const { t } = useTranslation();
  return (
    <span
      data-older-clients={effect}
      className={cn(
        'flex items-center gap-1.5 text-meta',
        isProtectedEffect(effect) ? 'text-muted-foreground' : 'text-warning',
        className,
      )}
    >
      <History aria-hidden="true" className="size-3.5 shrink-0" />
      {t(OLDER_CLIENTS_LINE_KEYS[effect])}
    </span>
  );
};
