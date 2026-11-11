/**
 * The deepest a request body may nest, counted as MySQL counts `JSON_DEPTH` (a scalar, `[]` and `{}` are 1; a
 * non-empty array or object is 1 + its deepest member). Content is stored as JSON one level shallower than a REST
 * body (`{ "data": … }`) and three shallower than a GraphQL one (`{ "variables": { "data": … } }`), so stored
 * content stays at most 63 levels deep: under MySQL's limit of 100 with 37 to spare for anything that wraps it.
 * The deepest content the schema invites is far shallower (components nest at most 5 levels: 11 JSON levels; a
 * rich-text value with six nested lists inside them: about 45).
 */
export const MAX_BODY_DEPTH = 64;
