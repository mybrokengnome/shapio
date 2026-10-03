import { HEALTH_RULES } from '@shapio/client';
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { findDefinition, readSchema } from '../definitions.js';
import { runTool } from './results.js';

/** Checks and signals: pre-flight for one entry, content health findings, field usage by consumers. */
export const registerInsightTools = ({ server, client }: ToolContext) => {
  server.registerTool(
    'preflight_run',
    {
      title: 'Pre-flight an entry',
      description:
        'What publishing these locales of an entry would run into (validation, missing locales, references, ' +
        'alt text), without publishing anything.',
      inputSchema: z.object({
        model: z.string().min(1).describe("The model's API ID"),
        id: z.string().min(1),
        locales: z.array(z.string()).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ model, id, locales }) =>
      runTool(() => client.admin.preflight.run(model, id, locales ? { locales } : {})),
  );

  server.registerTool(
    'health_list',
    {
      title: 'List content health findings',
      description: `Open findings of the content health rules (${HEALTH_RULES.join(', ')}), by rule and model.`,
      inputSchema: z.object({
        rule: z.enum(HEALTH_RULES).optional(),
        model: z.string().optional().describe("The model's API ID"),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ model, ...query }) =>
      runTool(() => client.admin.contentHealth.list({ ...query, ...(model ? { modelKey: model } : {}) })),
  );

  server.registerTool(
    'usage_fields',
    {
      title: 'Field usage',
      description:
        'Which fields of a model sites and apps read, per API token, over the last N days: check before ' +
        'renaming or removing a field.',
      inputSchema: z.object({
        model: z.string().min(1).describe("The model's API ID"),
        days: z.number().int().positive().max(365).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ model, days }) =>
      runTool(async () => {
        const { definition } = findDefinition(await readSchema(client), model);
        return client.admin.usage.fields({ modelId: definition.id, ...(days ? { days } : {}) });
      }),
  );
};
