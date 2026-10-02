import { z } from 'zod';

/** `/schema?file=schema/models/article.json`: the open file (the first one when absent or unknown). */
export const schemaSearchSchema = z.object({
  file: z.string().trim().min(1).max(300).optional().catch(undefined),
});

export type SchemaSearch = z.infer<typeof schemaSearchSchema>;
