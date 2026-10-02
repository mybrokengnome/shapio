import type { ModelDefinition } from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLFieldConfigMap,
} from 'graphql';
import { AppError } from '../../../helpers/appError.js';
import * as deliveryWritesService from '../../../services/contentDeliveryWrites.js';
import * as contentPublishingService from '../../../services/contentPublishing.js';
import type { AdminEntryView } from '../../../services/contentReads.js';
import type { SchemaBuild } from './build.js';
import type { GraphqlContext } from './context.js';
import { modelInput, toWriteData } from './inputTypes.js';
import { mutationName } from './names.js';
import { assertId, type RootField } from './operations.js';

/**
 * `createPage`, `updatePage`, `deletePage`, `publishPage`, `unpublishPage` (names from naming.ts). They call
 * the content services REST's delivery writes and publish endpoints call, under the same evaluator, and
 * return the entry's identity and state (`Entry`), never values: writes create drafts.
 */
type EntryResult = deliveryWritesService.DeliveryWriteResult['data'];

const fromAdminView = (view: AdminEntryView): EntryResult => ({
  id: view.id,
  locale: view.locale,
  version: view.version,
  status: view.status,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
  publishedAt: view.publishedAt,
});

const writeData = (build: SchemaBuild, model: ModelDefinition, args: Record<string, unknown>) =>
  args.data ? toWriteData(build, model, args.data as Record<string, unknown>) : {};

const missingExpectedVersion = () =>
  new AppError(
    400,
    'INVALID_INPUT',
    'expectedVersion is required: the version you loaded, or null to add a new locale',
  );

export const mutationFields = (
  build: SchemaBuild,
  model: ModelDefinition,
): GraphQLFieldConfigMap<unknown, GraphqlContext> => {
  const input = modelInput(build, model);
  const data: GraphQLFieldConfigArgumentMap = input ? { data: { type: input } } : {};
  const entry = build.fixed.entry;
  const id = { id: { type: new GraphQLNonNull(GraphQLID) } };
  const locales = { locales: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) } };
  const fields: Record<string, RootField> = {
    [mutationName('create', model)]: {
      type: entry,
      description: `Creates a ${model.label} entry (a draft unless \`publish\` is true)`,
      args: { ...data, locale: { type: GraphQLString }, publish: { type: GraphQLBoolean } },
      resolve: async (_root, args, context) =>
        (
          await deliveryWritesService.createDeliveryEntry(
            await context.content(build.snapshot),
            model.apiKey,
            {
              ...(args.locale ? { locale: args.locale as string } : {}),
              data: writeData(build, model, args),
              publish: Boolean(args.publish),
            },
          )
        ).data,
    },
    [mutationName('update', model)]: {
      type: entry,
      description: 'Changes the given fields of the draft (a patch: omitted fields keep their values)',
      args: { ...id, ...data, locale: { type: GraphQLString }, expectedVersion: { type: GraphQLInt } },
      resolve: async (_root, args, context) => {
        if (!Object.hasOwn(args, 'expectedVersion')) {
          throw missingExpectedVersion();
        }
        return (
          await deliveryWritesService.updateDeliveryEntry(
            await context.content(build.snapshot),
            model.apiKey,
            assertId(args.id),
            {
              ...(args.locale ? { locale: args.locale as string } : {}),
              expectedVersion: (args.expectedVersion as number | null) ?? null,
              data: writeData(build, model, args),
            },
          )
        ).data;
      },
    },
    [mutationName('delete', model)]: {
      type: new GraphQLNonNull(GraphQLID),
      args: id,
      resolve: async (_root, args, context) => {
        const entryId = assertId(args.id);
        await deliveryWritesService.deleteDeliveryEntry(
          await context.content(build.snapshot),
          model.apiKey,
          entryId,
        );
        return entryId;
      },
    },
  };
  for (const operation of ['publish', 'unpublish'] as const) {
    fields[mutationName(operation, model)] = {
      type: entry,
      description: `${operation === 'publish' ? 'Publishes' : 'Unpublishes'} the given locales (default: the default locale)`,
      args: { ...id, ...locales },
      resolve: async (_root, args, context) => {
        const service = await context.content(build.snapshot);
        const change =
          operation === 'publish'
            ? contentPublishingService.publishEntry
            : contentPublishingService.unpublishEntry;
        const view = await change(service, model.apiKey, assertId(args.id), {
          ...(args.locales ? { locales: args.locales as string[] } : {}),
        });
        return fromAdminView(view);
      },
    };
  }
  return fields;
};
