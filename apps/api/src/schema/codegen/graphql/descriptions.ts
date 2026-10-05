/**
 * GraphQL descriptions from the schema's own words, so GraphiQL's docs panel and introspection show what
 * the admin shows: the label as the summary line, the help text (or model/component description) as a
 * second paragraph. Descriptions are CommonMark in GraphQL; the paragraph break keeps them apart.
 */
type Described = { label: string; description?: string };

export const describeDefinition = ({ label, description }: Described): string => {
  const help = description?.trim();
  return help ? `${label}\n\n${help}` : label;
};
