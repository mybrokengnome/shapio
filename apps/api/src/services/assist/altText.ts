import { completeText } from '../../assist/completion.js';
import type { UsageMeter } from '../../assist/completion.js';
import { assistImageOf } from '../../assist/image.js';
import { ALT_TEXT_MAX_LENGTH, altTextPrompt } from '../../assist/prompts/altText.js';
import { AppError } from '../../helpers/appError.js';
import * as mediaAssetsRepository from '../../repositories/mediaAssets.js';
import type { MediaAssetRow } from '../../repositories/mediaAssets.js';
import type { AssistServiceContext } from './context.js';
import { assertLocale } from './entrySource.js';
import { runAssist } from './runs.js';
import { cleanModelText, fitToLength } from './text.js';

export type AltTextInput = { assetId: string; locale?: string | undefined };
export type AltTextResult = { alt: string; model: string };

/** One alt text for one asset (shared with content-ops, which records its own run). */
export const proposeAltText = async (
  context: AssistServiceContext,
  meter: UsageMeter,
  asset: MediaAssetRow,
  locale: string,
): Promise<string> => {
  const image = await assistImageOf(context.storage, asset);
  const prompt = altTextPrompt({ locale, filename: asset.original_filename });
  const text = await completeText(context.assist.provider, meter, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    images: [image],
    ...(context.signal ? { signal: context.signal } : {}),
  });
  return fitToLength(cleanModelText(text, { singleLine: true }), ALT_TEXT_MAX_LENGTH).text;
};

/**
 * Alt text for a library asset (`media.read`). Writes nothing: the editor applies it as a normal edit. The
 * image is sent whatever its visibility, since the caller can read it (documented in assist.md).
 */
export const writeAltText = async (
  context: AssistServiceContext,
  input: AltTextInput,
): Promise<AltTextResult> => {
  const locale = assertLocale(context, input.locale ?? context.snapshot.defaultLocale);
  const asset = await mediaAssetsRepository.findLiveOnSite(context.site.id, input.assetId, context.db);
  if (!asset) {
    throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
  }
  return runAssist(
    context,
    { action: 'alt_text', target: { type: 'media_asset', id: asset.id }, metadata: { locale } },
    async (meter) => ({ alt: await proposeAltText(context, meter, asset, locale), model: meter.model }),
  );
};
