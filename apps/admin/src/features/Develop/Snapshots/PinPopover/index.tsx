import { Pin } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiBaseUrl } from '@/api/client';
import { useApiTokens } from '@/api/tokens';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type PinPopoverProps = {
  seq: number;
  /** The visible label; "Pin" by default. */
  label?: string;
  variant?: 'ghost' | 'outline';
};

/**
 * "Pin a token": pinning is done by the reader (it sends `snapshot=N` with its requests), so this shows the
 * request to make with the chosen token, ready to copy. The Live page then lists the token as pinned.
 */
export const PinPopover = ({ seq, label, variant = 'ghost' }: PinPopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [tokenId, setTokenId] = useState<string | undefined>(undefined);
  const tokens = useApiTokens();
  const active = (tokens.data ?? []).filter((token) => token.revokedAt === null);
  const token = active.find((candidate) => candidate.id === tokenId) ?? active[0];
  const snippet = `curl -H "Authorization: Bearer ${token ? `${token.tokenPrefix}…` : '<token>'}" "${apiBaseUrl()}api/content/<model>?snapshot=${seq}"`;
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button variant={variant} size="sm" aria-label={label ? undefined : t('snapshots.pinLabel', { seq })}>
          <Pin aria-hidden="true" />
          {label ?? t('snapshots.pin')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="w-96 max-w-[calc(100vw-2rem)] space-y-3"
      >
        <p id={titleId} className="text-sm font-semibold">
          {t('snapshots.pinTitle', { seq })}
        </p>
        <p className="text-meta text-muted-foreground">{t('snapshots.pinDescription')}</p>
        {active.length > 0 ? (
          <div className="space-y-1.5">
            <label htmlFor={selectId} className="text-sm font-semibold">
              {t('snapshots.pinToken')}
            </label>
            <Select value={token?.id} onValueChange={setTokenId}>
              <SelectTrigger id={selectId} size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {active.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {snippet}
        </pre>
        <div className="flex justify-end">
          <CopyButton value={snippet} />
        </div>
      </PopoverContent>
    </Popover>
  );
};
