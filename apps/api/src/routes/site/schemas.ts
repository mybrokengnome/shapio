import { SeoLocaleDefaultsSchema, SEO_TWITTER_HANDLE_PATTERN } from '@shapio/schema';
import { Type } from 'typebox';
import { ErrorResponseSchema } from '../schemas/error.js';

/** The default social image as delivery shows any asset (the media field shape). */
const DeliveredImageSchema = Type.Record(Type.String(), Type.Unknown());

export const DeliverySiteSchema = Type.Object({
  key: Type.String(),
  name: Type.String(),
  seo: Type.Object({
    locales: Type.Record(Type.String(), SeoLocaleDefaultsSchema),
    twitterHandle: Type.Union([Type.String({ pattern: SEO_TWITTER_HANDLE_PATTERN.source }), Type.Null()]),
    image: Type.Union([DeliveredImageSchema, Type.Null()]),
  }),
});

export const getDeliverySiteSchema = {
  response: {
    200: DeliverySiteSchema,
    304: { type: 'null' },
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
  },
};
