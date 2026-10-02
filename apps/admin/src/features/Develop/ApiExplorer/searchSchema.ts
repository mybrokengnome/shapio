import { z } from 'zod';

export const EXPLORER_TABS = ['rest', 'graphql'] as const;
export type ExplorerTab = (typeof EXPLORER_TABS)[number];

/** `/api-explorer?tab=rest&op=listArticle`: the tab and the selected operation (OpenAPI operationId or GraphQL root field). */
export const apiExplorerSearchSchema = z.object({
  tab: z.enum(EXPLORER_TABS).optional().catch(undefined),
  op: z.string().trim().min(1).max(200).optional().catch(undefined),
});

export type ApiExplorerSearch = z.infer<typeof apiExplorerSearchSchema>;
