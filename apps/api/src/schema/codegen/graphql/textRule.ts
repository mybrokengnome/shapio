import { findInvalidText, INVALID_TEXT_MESSAGE } from '@shapio/schema';
import { GraphQLError, type ValidationRule } from 'graphql';

/**
 * String literals in a GraphQL document are decoded from escapes (`"a\u0000b"`), so a NUL character or an
 * unpaired surrogate can reach a filter without appearing in the request body; variables are checked with
 * the rest of the body (plugins/textInput.ts). Refused as `INVALID_TEXT` like REST.
 */
export const textLiteralsRule: ValidationRule = (context) => ({
  StringValue: (node) => {
    if (findInvalidText(node.value) !== undefined) {
      context.reportError(
        new GraphQLError(`Text ${INVALID_TEXT_MESSAGE}`, {
          nodes: node,
          extensions: { code: 'INVALID_TEXT' },
        }),
      );
    }
  },
});
