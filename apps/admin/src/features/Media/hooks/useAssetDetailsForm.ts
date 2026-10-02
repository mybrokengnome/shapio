import { zodResolver } from '@hookform/resolvers/zod';
import type { MediaAsset, UpdateMediaAssetInput } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateMediaAsset } from '@/api/media';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const MAX_FILENAME = 255;
const MAX_ALT = 1000;
const MAX_CAPTION = 4000;

const detailsSchema = z.object({
  filename: requiredText().max(MAX_FILENAME, 'validation.tooLong'),
  alt: z.string().max(MAX_ALT, 'validation.tooLong'),
  caption: z.string().max(MAX_CAPTION, 'validation.tooLong'),
  focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
});

export type AssetDetailsValues = z.infer<typeof detailsSchema>;

const valuesFor = (asset: MediaAsset | undefined): AssetDetailsValues => ({
  filename: asset?.filename ?? '',
  alt: asset?.alt ?? '',
  caption: asset?.caption ?? '',
  focalPoint: asset?.focalPoint ?? null,
});

/** Only what changed is sent, with the version the editor saw (409 VERSION_CONFLICT if it moved). */
const changesFrom = (asset: MediaAsset, values: AssetDetailsValues): UpdateMediaAssetInput => ({
  expectedVersion: asset.version,
  ...(values.filename !== asset.filename ? { filename: values.filename.trim() } : {}),
  ...(values.alt !== asset.alt ? { alt: values.alt } : {}),
  ...(values.caption !== asset.caption ? { caption: values.caption } : {}),
  ...(JSON.stringify(values.focalPoint) !== JSON.stringify(asset.focalPoint)
    ? { focalPoint: values.focalPoint }
    : {}),
});

/** File name, alt text, caption and focal point of one asset. */
export const useAssetDetailsForm = (asset: MediaAsset | undefined) => {
  const update = useUpdateMediaAsset();
  const form = useForm<AssetDetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: valuesFor(asset),
  });
  const { reset } = form;
  // A different asset (or a fresh load of this one) starts from what the server has.
  useEffect(() => {
    reset(valuesFor(asset));
    update.reset();
    // The mutation object changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, reset]);
  const onSubmit = form.handleSubmit(async (values) => {
    if (!asset) {
      return;
    }
    const result = await settle(update.mutateAsync({ id: asset.id, input: changesFrom(asset, values) }));
    if (result.ok) {
      reset(valuesFor(result.value));
      toast.success(i18next.t('media.details.saved'));
    }
  });
  return { form, onSubmit, pending: update.isPending, error: update.error };
};
