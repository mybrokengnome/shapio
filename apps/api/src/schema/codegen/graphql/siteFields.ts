import {
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  type GraphQLFieldConfigMap,
  type GraphQLNullableType,
} from 'graphql';
import * as siteSeoService from '../../../services/siteSeo.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlContext } from './context.js';
import type { FixedTypes } from './fixedTypes.js';

/**
 * `_site` (plan seo-fields): the request's site and its SEO defaults, through the same service as REST
 * `GET /api/site`. Underscored like `_snapshot`, so a model called `site` keeps its own root fields; the name
 * and the `SiteInfo`/`SiteSeo*` types are reserved in `@shapio/schema` naming.ts. SEO fields on entries stay
 * raw in GraphQL: merge them with `resolveSeo()` from `@shapio/client`.
 */
export const SITE_QUERY = '_site';

const nonNull = <T extends GraphQLNullableType>(type: T) => new GraphQLNonNull(type);

type LocaleTexts = { locale: string; siteName?: string; titleTemplate?: string; description?: string };

const createTypes = (media: FixedTypes['media']) => {
  const locale = new GraphQLObjectType({
    name: 'SiteSeoLocale',
    description: "One locale's default SEO texts; a missing one falls back along the locale chain",
    fields: {
      locale: { type: nonNull(GraphQLString) },
      siteName: { type: GraphQLString },
      titleTemplate: {
        type: GraphQLString,
        description: 'Page titles go through it: `%s` is replaced by the title, e.g. `%s · Acme`',
      },
      description: { type: GraphQLString, description: 'Used where an entry has no SEO description' },
    },
  });
  const seo = new GraphQLObjectType({
    name: 'SiteSeoDefaults',
    fields: {
      locales: {
        type: nonNull(new GraphQLList(nonNull(locale))),
        resolve: (source: siteSeoService.DeliverySiteView['seo']): LocaleTexts[] =>
          Object.entries(source.locales).map(([code, texts]) => ({ locale: code, ...texts })),
      },
      twitterHandle: { type: GraphQLString },
      image: { type: media, description: 'The default social image (a public image), or null' },
    },
  });
  return new GraphQLObjectType({
    name: 'SiteInfo',
    description: 'The site this request reads, and its SEO defaults',
    fields: {
      key: { type: nonNull(GraphQLString) },
      name: { type: nonNull(GraphQLString) },
      seo: { type: nonNull(seo) },
    },
  });
};

export const siteQueryFields = (
  snapshot: SchemaSnapshot,
  fixed: FixedTypes,
): GraphQLFieldConfigMap<unknown, GraphqlContext> => ({
  [SITE_QUERY]: {
    type: nonNull(createTypes(fixed.media)),
    description: "The request's site: its key, name and SEO defaults",
    resolve: async (_root, _args, context) => siteSeoService.getDeliverySite(await context.content(snapshot)),
  },
});
