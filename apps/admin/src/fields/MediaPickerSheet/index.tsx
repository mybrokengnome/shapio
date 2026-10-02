import type { MediaAsset } from '@shapio/client';
import type { MediaPickOptions } from '@shapio/editor-sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminApi } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { MIME_FILTER_BY_TYPE, type MediaTypeFilter, type MediaView } from '@/features/Media/constants';
import { Library } from '@/features/Media/Library';
import { Toolbar } from '@/features/Media/Toolbar';
import { UploadButton } from '@/features/Media/UploadButton';
import { UploadQueue } from '@/features/Media/UploadQueue';
import { reportError } from '@/helpers/reportError';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { useMediaUploader } from '@/hooks/useMediaUploader';
import { mediaKindOf, mimeFilterFor } from '../helpers/media';

type MediaPickerSheetProps = {
  open: boolean;
  options: MediaPickOptions;
  onPick: (assets: MediaAsset[]) => void;
  onCancel: () => void;
};

/**
 * The media library's components in a large right-hand sheet, so the entry stays in view: search, filter,
 * upload, and choose one or several files. Files of kinds the field does not allow can be seen but not
 * chosen.
 */
export const MediaPickerSheet = ({ open, options, onPick, onCancel }: MediaPickerSheetProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canWrite } = useMediaPermissions();
  const uploader = useMediaUploader();
  const [search, setSearch] = useState<string | undefined>();
  const [type, setType] = useState<MediaTypeFilter | undefined>();
  const [view, setView] = useState<MediaView>('grid');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const multiple = options.multiple === true;
  const forcedMime = mimeFilterFor(options.allowedKinds);
  const query = {
    ...(search ? { search } : {}),
    ...(forcedMime ? { mimeType: forcedMime } : type ? { mimeType: MIME_FILTER_BY_TYPE[type] } : {}),
  };
  const select = (id: string, checked: boolean) =>
    setSelected((current) => {
      if (!checked) {
        return current.filter((item) => item !== id);
      }
      return multiple ? [...current.filter((item) => item !== id), id] : [id];
    });
  const close = () => {
    setSelected([]);
    onCancel();
  };
  const confirm = async () => {
    setConfirming(true);
    try {
      const assets = await Promise.all(
        selected.map((id) =>
          queryClient.fetchQuery({
            queryKey: queryKeys.media.asset(id),
            queryFn: () => adminApi.media.assets.get(id),
          }),
        ),
      );
      const allowed = assets.filter(
        (asset) => !options.allowedKinds || options.allowedKinds.includes(mediaKindOf(asset.mimeType)),
      );
      setSelected([]);
      onPick(allowed);
    } catch (error) {
      reportError(error, 'choosing media');
    } finally {
      setConfirming(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetContent size="lg" {...(options.allowedKinds ? {} : { 'aria-describedby': undefined })}>
        <SheetHeader className="pr-14">
          <SheetTitle>
            {multiple ? t('content.media.pickTitleMultiple') : t('content.media.pickTitle')}
          </SheetTitle>
          {options.allowedKinds ? (
            <SheetDescription>
              {t('content.media.allowedKinds', { kinds: options.allowedKinds.join(', ') })}
            </SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="space-y-4 px-6 pb-4">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <Toolbar
                query={search}
                type={forcedMime ? undefined : type}
                view={view}
                onQueryChange={setSearch}
                onTypeChange={setType}
                onViewChange={setView}
              />
            </div>
            {canWrite ? (
              <UploadButton
                variant="outline"
                label={t('media.upload.action')}
                multiple={multiple}
                onFiles={(files) => uploader.enqueue(files, { folderId: null, visibility: 'public' })}
              />
            ) : null}
          </div>
          <UploadQueue onRetry={uploader.retry} onDismiss={uploader.dismiss} />
        </div>
        {/* A little top padding so the selected tiles' rings aren't clipped by the scroll area. */}
        <SheetBody className="pt-1">
          <Library
            query={query}
            filtered={Boolean(search || type)}
            view={view}
            selected={new Set(selected)}
            selectable
            activeId={undefined}
            onSelectChange={select}
            onOpen={(asset) => select(asset.id, !selected.includes(asset.id))}
          />
        </SheetBody>
        <SheetFooter>
          <span role="status" className="mr-auto text-sm text-muted-foreground">
            {t('content.media.selectedCount', { count: selected.length })}
          </span>
          <Button type="button" variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={selected.length === 0 || confirming} onClick={() => void confirm()}>
            {t('content.media.choose', { count: selected.length })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
