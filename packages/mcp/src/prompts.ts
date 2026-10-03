import { z } from 'zod';
import type { ToolContext } from './context.js';

const userMessage = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

/** Starting points for the two jobs agents do most: modelling and reviewing a change set. */
export const registerPrompts = ({ server }: ToolContext) => {
  server.registerPrompt(
    'model_content_type',
    {
      title: 'Model a content type for …',
      description: 'Design a content type for something and draft it into a change set for review.',
      argsSchema: z.object({
        subject: z.string().min(1).describe('What the content type is for, e.g. "a blog"'),
      }),
    },
    ({ subject }) =>
      userMessage(
        `Model content types in Shapio for ${subject}.\n\n` +
          '1. Call schema_list and read the existing types first; reuse or extend them instead of duplicating.\n' +
          '2. Design the types: API IDs are camelCase GraphQL names, labels are for people; prefer components ' +
          'for repeated groups and relations for shared entities.\n' +
          '3. Draft each type with schema_draft (one change set for the whole design: pass the changeSetId ' +
          'from the first call to the rest).\n' +
          '4. Read change_sets_review, fix every blocking issue, and summarise the design and the review for ' +
          'me. Do not ship: I review and ship the change set myself.',
      ),
  );

  server.registerPrompt(
    'review_change_set',
    {
      title: 'Review change set N',
      description: 'Explain what a change set would do when it ships, and what to check first.',
      argsSchema: z.object({ changeSetId: z.string().min(1).describe('The change set ID') }),
    },
    ({ changeSetId }) =>
      userMessage(
        `Review Shapio change set ${changeSetId}. Call change_sets_review and tell me, briefly:\n` +
          '- what goes live (schema changes and entries, with the field diffs that matter);\n' +
          '- anything breaking or destructive, and which API consumers read the affected fields ' +
          '(usage_fields);\n' +
          '- blocking issues and warnings, and how to fix each;\n' +
          '- whether you would ship it. Do not ship it yourself.',
      ),
  );
};
