import { ResourceTemplate } from '@modelcontextprotocol/server';
import { serializeDefinition } from '@shapio/schema';
import type { ToolContext } from './context.js';
import { findDefinition, readSchema } from './definitions.js';
import { DELIVERY_API_DOC } from './generated/deliveryApiDoc.js';

export const SCHEMA_URI_TEMPLATE = 'shapio://schema/{apiKey}';
export const DELIVERY_DOC_URI = 'shapio://docs/delivery-api';

/** Each definition in the pull format (`shapio schema pull`'s files), and the delivery API guide. */
export const registerResources = ({ server, client }: ToolContext) => {
  server.registerResource(
    'schema',
    new ResourceTemplate(SCHEMA_URI_TEMPLATE, {
      list: async () => {
        const schema = await readSchema(client);
        return {
          resources: schema.definitions.map(({ definition }) => ({
            uri: `shapio://schema/${definition.apiKey}`,
            name: definition.apiKey,
            title: definition.label,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Content type definition',
      description:
        "A model or component of this server's site (its own or shared with all sites) in the schema file format, with stable IDs.",
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const apiKey = String(variables.apiKey);
      const { definition } = findDefinition(await readSchema(client), apiKey);
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: serializeDefinition(definition) }],
      };
    },
  );

  server.registerResource(
    'delivery-api',
    DELIVERY_DOC_URI,
    {
      title: 'Delivery API guide',
      description: 'How sites and apps read published content: routes, filters, locales, snapshots, tokens.',
      mimeType: 'text/markdown',
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DELIVERY_API_DOC }] }),
  );
};
