import { AppError } from '../helpers/appError.js';

/** Errors of the assist engine. Messages never echo prompts, keys or provider payloads. */
export const assistInvalidOutput = (message: string, details?: unknown) =>
  new AppError(502, 'ASSIST_INVALID_OUTPUT', message, details);

export const assistProviderError = (message: string) => new AppError(502, 'ASSIST_PROVIDER_ERROR', message);

export const assistProviderAuth = () =>
  new AppError(
    502,
    'ASSIST_PROVIDER_AUTH',
    'The model provider rejected the configured credentials (check AI_API_KEY and AI_MODEL)',
  );

export const assistProviderBusy = () =>
  new AppError(
    503,
    'ASSIST_PROVIDER_BUSY',
    'The model provider is rate limiting requests; try again shortly',
  );

export const assistVisionUnsupported = () =>
  new AppError(
    422,
    'ASSIST_VISION_UNSUPPORTED',
    'The configured model does not accept images; configure a vision-capable model for alt text',
  );

export const assistDeclined = () => new AppError(422, 'ASSIST_DECLINED', 'The model declined this request');

export const assistNotAnImage = () =>
  new AppError(
    422,
    'ASSIST_NOT_AN_IMAGE',
    'Alt text can only be written for raster images (JPEG, PNG, WebP, GIF, AVIF, TIFF)',
  );

export const assistDisabled = () =>
  new AppError(409, 'ASSIST_DISABLED', 'Assist is off on this server (AI_PROVIDER is not set)');
