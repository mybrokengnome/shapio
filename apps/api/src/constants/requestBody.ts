/**
 * How deep content may nest, counted as MySQL counts `JSON_DEPTH` (a scalar, `[]` and `{}` are 1; a non-empty
 * array or object is 1 + its deepest member). An entry's data as stored may be at most `MAX_CONTENT_DEPTH` deep:
 * MySQL's own limit, so whatever the API takes, every database stores.
 *
 * Everything the schema validator accepts fits, with room to spare. The deepest valid data is rich text as deep as
 * it may nest inside components as deep as they may nest:
 * - rich text: the envelope `{ format, version, doc }` is 1 level, the `doc` node 1 more, and each node below
 *   it 2 (the node and its `content` list). A text node at the deepest node depth (`MAX_RICHTEXT_DEPTH` 40, the
 *   doc at 0) sits at level 2 + 2 × 40 = 82; its `marks` list, a mark, the mark's `attrs`, and an attribute's
 *   value add 4: 86 levels.
 * - components (`MAX_COMPONENT_DEPTH` 5): a list or dynamic-zone level adds 2 (the list and the item), a single
 *   component 1: at most 10.
 * - the data object itself: 1.
 * So 1 + 10 + 86 = 97 at most, under 100. A json field may hold anything up to the limit.
 *
 * Every way of sending content is held to the same depth of the content itself: a REST body wraps it in
 * `{ data }` (`MAX_BODY_DEPTH`), a GraphQL request in `{ variables: { data } }` (`MAX_GRAPHQL_BODY_DEPTH`), and a
 * GraphQL argument is the content (schema/codegen/graphql/documentDepth.ts).
 */
export const MAX_CONTENT_DEPTH = 100;
/** The deepest a request body may nest: `{ "data": … }` around content at most `MAX_CONTENT_DEPTH` deep. */
export const MAX_BODY_DEPTH = MAX_CONTENT_DEPTH + 1;
/** A GraphQL request body: `{ "variables": { "data": … } }` around content at most `MAX_CONTENT_DEPTH` deep. */
export const MAX_GRAPHQL_BODY_DEPTH = MAX_CONTENT_DEPTH + 2;
