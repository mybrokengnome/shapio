import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaAsset } from '@/api/media';
import { CopyButton } from '@/components/CopyButton';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { StatusChip } from '@/components/StatusChip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { fileKindLabel } from '../helpers/fileKind';
import { formatBytes } from '../helpers/formatBytes';
import { MEDIA_STATUS_DISPLAY } from '../helpers/statusDisplay';
import { useAssetDetailsForm } from '../hooks/useAssetDetailsForm';
import { UploadButton } from '../UploadButton';
import { DeleteAction } from './DeleteAction';
import { MetadataForm } from './MetadataForm';
import { Preview } from './Preview';
import { Section } from './Section';
import { Usage } from './Usage';
import { Variants } from './Variants';
import { Visibility } from './Visibility';

type DetailsProps = {
  assetId: string | undefined;
  onClose: () => void;
  onReplace: (assetId: string, file: File) => void;
};

/** One asset: preview, metadata, focal point, visibility, variants, "used in", replace and delete. */
export const Details = ({ assetId, onClose, onReplace }: DetailsProps) => {
  const { t } = useTranslation();
  const query = useMediaAsset(assetId);
  const asset = query.data;
  const { canWrite, canManage } = useMediaPermissions();
  const details = useAssetDetailsForm(asset);
  const { requestOpenChange, discardPrompt } = useDiscardGuard({
    dirty: details.form.formState.isDirty,
    pending: details.pending,
    onOpenChange: (open) => {
      if (!open) {
        details.form.reset();
        onClose();
      }
    },
  });
  const status = asset ? MEDIA_STATUS_DISPLAY[asset.status] : undefined;
  return (
    <>
      <Sheet open={assetId !== undefined} onOpenChange={requestOpenChange}>
        <SheetContent size="sm">
          <SheetHeader>
            <SheetTitle className="pr-8 break-all">{asset?.filename ?? t('media.details.title')}</SheetTitle>
            <SheetDescription className="text-meta">
              {asset
                ? [
                    fileKindLabel(asset.filename, asset.mimeType),
                    formatBytes(asset.sizeBytes),
                    asset.width && asset.height
                      ? t('media.dimensions', { width: asset.width, height: asset.height })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('common.loading')}
            </SheetDescription>
            {asset && status ? (
              // In the fixed header, not the scrolling body: the focus trap wraps here without scrolling.
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusChip tone={status.tone} label={t(status.labelKey)} />
                {asset.visibility === 'private' ? (
                  <StatusChip tone="muted" label={t('media.visibility.private')} />
                ) : null}
                <span className="ml-auto">
                  <CopyButton value={asset.url} />
                </span>
              </div>
            ) : null}
          </SheetHeader>
          <SheetBody className="space-y-6">
            {query.isPending ? <LoadingState rows={3} /> : null}
            {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
            {asset && status ? (
              <>
                <div className="space-y-3">
                  <Preview asset={asset} />
                  {asset.urlExpiresAt ? (
                    <p className="text-meta text-muted-foreground">{t('media.details.signedLinkNote')}</p>
                  ) : null}
                  {asset.processingError ? (
                    <Alert variant="destructive">
                      <AlertTriangle aria-hidden="true" />
                      <AlertDescription>{asset.processingError}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
                <Section title={t('media.details.metadata')}>
                  <MetadataForm
                    asset={asset}
                    form={details.form}
                    onSubmit={() => void details.onSubmit()}
                    pending={details.pending}
                    error={details.error}
                    readOnly={!canWrite}
                  />
                </Section>
                <Section title={t('media.usage.title')}>
                  <Usage assetId={asset.id} />
                </Section>
                <Section title={t('media.visibility.title')}>
                  <Visibility asset={asset} canManage={canManage} />
                </Section>
                <Section title={t('media.variants.title')}>
                  <Variants asset={asset} />
                </Section>
              </>
            ) : null}
          </SheetBody>
          {asset && (canWrite || canManage) ? (
            <SheetFooter className="flex-row flex-wrap justify-between">
              {canManage ? <DeleteAction asset={asset} onDeleted={onClose} /> : null}
              {canWrite ? (
                <UploadButton
                  variant="outline"
                  multiple={false}
                  label={t('media.details.replace')}
                  onFiles={([file]) => (file ? onReplace(asset.id, file) : undefined)}
                  className="ml-auto"
                />
              ) : null}
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
      {discardPrompt}
    </>
  );
};
