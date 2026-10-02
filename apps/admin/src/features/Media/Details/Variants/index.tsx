import type { MediaAsset } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { isKnownVariant, VARIANT_LABEL_KEYS } from '../../constants';
import { formatBytes } from '../../helpers/formatBytes';
import { MEDIA_STATUS_DISPLAY } from '../../helpers/statusDisplay';

type VariantsProps = { asset: MediaAsset };

/** Generated sizes and their status (made in the background after upload). */
export const Variants = ({ asset }: VariantsProps) => {
  const { t } = useTranslation();
  if (asset.variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {asset.status === 'processing' ? t('media.variants.processing') : t('media.variants.none')}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border">
      {asset.variants.map((variant) => {
        const label = isKnownVariant(variant.name) ? t(VARIANT_LABEL_KEYS[variant.name]) : variant.name;
        const status = MEDIA_STATUS_DISPLAY[variant.status];
        return (
          <li key={variant.name} className="flex min-w-0 items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              {variant.url ? (
                <a
                  href={variant.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm text-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {label}
                </a>
              ) : (
                <span className="text-sm font-medium">{label}</span>
              )}
              <span className="block truncate text-meta text-muted-foreground">
                {variant.width && variant.height
                  ? t('media.dimensions', { width: variant.width, height: variant.height })
                  : null}
                {variant.sizeBytes ? ` · ${formatBytes(variant.sizeBytes)}` : null}
              </span>
            </span>
            <StatusChip tone={status.tone} label={t(status.labelKey)} size="sm" />
          </li>
        );
      })}
    </ul>
  );
};
