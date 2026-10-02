import type { FieldDefinition } from '@shapio/schema';
import { Crosshair, ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMediaAsset } from '@/api/media';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldMessages } from '@/fields/FieldMessages';
import { useFieldsEnvironment } from '@/fields/form/context';
import { useFieldControl } from '@/fields/hooks/useFieldControl';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { cn } from '@/helpers/cn';
import { logError, reportError } from '@/helpers/reportError';

type CoverProps = {
  field: FieldDefinition;
  /** Opens the settings drawer at the cover's alt text and focal point. */
  onEditDetails: () => void;
};

const COVER_VARIANTS = ['w1280', 'w640'];
const PERCENT = 100;

const coverId = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * The cover image above the title: full width, cropped around its focal point, with Replace / Focal point /
 * Remove on hover or focus. A file dropped onto it replaces it (uploaded to the library). Empty: a dashed
 * "Add a cover" band that also takes a drop.
 */
export const Cover = ({ field, onEditDetails }: CoverProps) => {
  const { t } = useTranslation();
  const { model, readOnly, disabled, pickMedia, uploadMedia } = useFieldsEnvironment();
  const { value, onChange } = useTopLevelValue(field);
  const path = `/${field.apiKey}`;
  const control = useFieldControl({ field, owner: model, value, onChange, path });
  const id = coverId(value);
  const asset = useMediaAsset(id);
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(false);
  // After choosing from the band, focus lands on Replace (the band itself is gone).
  const [focusReplace, setFocusReplace] = useState(false);
  const replaceRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusReplace && id && replaceRef.current) {
      replaceRef.current.focus();
      setFocusReplace(false);
    }
  }, [focusReplace, id]);
  const editable = !readOnly && !disabled;
  const url =
    COVER_VARIANTS.map(
      (name) => asset.data?.variants.find((variant) => variant.name === name && variant.url)?.url,
    ).find(Boolean) ?? asset.data?.url;
  const choose = async () => {
    try {
      const picked = await pickMedia({ multiple: false, allowedKinds: ['image'] });
      const first = picked?.[0];
      if (first) {
        onChange(first.id);
        control.builtInProps.onBlur();
        setFocusReplace(true);
      }
    } catch (error) {
      reportError(error, 'choosing a cover');
    }
  };
  const drop = async (event: DragEvent) => {
    setDropping(false);
    const file = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith('image/'));
    if (!file || !uploadMedia || !editable) {
      return;
    }
    event.preventDefault();
    setUploading(true);
    try {
      onChange((await uploadMedia(file)).id);
    } catch (error) {
      logError(error, `uploading ${file.name} as a cover`);
      toast.error(t('entry.upload.failed', { name: file.name }));
    } finally {
      setUploading(false);
    }
  };
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (editable && uploadMedia && event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        setDropping(true);
      }
    },
    onDragLeave: () => setDropping(false),
    onDrop: (event: DragEvent) => void drop(event),
  };
  const focal = asset.data?.focalPoint ?? { x: 0.5, y: 0.5 };
  return (
    <div className="space-y-1" data-field-path={path} id={`${control.inputId}-section`}>
      <span id={control.labelId} className="sr-only">
        {field.label}
      </span>
      {id ? (
        <div
          role="group"
          aria-labelledby={control.labelId}
          className={cn(
            'group/cover relative overflow-hidden rounded-xl bg-muted',
            dropping && 'ring-[3px] ring-ring/50',
          )}
          {...dropProps}
        >
          {asset.isPending || uploading ? (
            <Skeleton className="h-56 w-full sm:h-72" />
          ) : url ? (
            <img
              src={url}
              alt={asset.data?.alt ?? ''}
              className="h-56 w-full object-cover object-(--focal) sm:h-72"
              style={{ '--focal': `${focal.x * PERCENT}% ${focal.y * PERCENT}%` } as CSSProperties}
            />
          ) : (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground sm:h-72">
              {t('content.media.missing')}
            </div>
          )}
          {editable ? (
            <div className="absolute right-3 bottom-3 flex flex-wrap gap-1.5 opacity-0 transition-opacity group-focus-within/cover:opacity-100 group-hover/cover:opacity-100 max-lg:opacity-100">
              <Button
                ref={replaceRef}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void choose()}
              >
                <RefreshCw aria-hidden="true" />
                {t('entry.cover.replace')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={onEditDetails}>
                <Crosshair aria-hidden="true" />
                {t('entry.cover.details')}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => onChange(null)}>
                <Trash2 aria-hidden="true" />
                {t('entry.cover.remove')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : editable ? (
        <button
          id={control.inputId}
          type="button"
          aria-describedby={control.builtInProps.describedBy}
          onClick={() => void choose()}
          {...dropProps}
          className={cn(
            'flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            dropping && 'bg-muted/50 ring-[3px] ring-ring/50',
          )}
        >
          {uploading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ImagePlus aria-hidden="true" className="size-4" />
          )}
          {uploadMedia
            ? t('entry.cover.addOrDrop', { field: field.label })
            : t('entry.cover.add', { field: field.label })}
        </button>
      ) : null}
      <FieldMessages field={field} control={control} />
    </div>
  );
};
