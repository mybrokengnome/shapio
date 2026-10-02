import { parseDefinition, validateSchema, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';
import { newStableId } from '@/helpers/stableId';

/**
 * What a schema file's text means: not JSON (the editor's JSON linter points at the syntax error), an
 * invalid definition (issues with JSON-pointer paths into the file), or a valid definition. The checks are
 * the server's own (`parseDefinition`, then `validateSchema` across every definition), so what the editor
 * accepts is what `PUT …/schema/:definitionId` and `shapio schema apply` accept.
 */
export type FileAnalysis =
  | { status: 'invalidJson'; message: string }
  | { status: 'invalid'; raw: unknown; issues: ValidationIssue[] }
  | { status: 'valid'; raw: unknown; definition: SchemaDefinition };

export type AnalyzeContext = {
  /** The file's base definition (fields without an ID keep the ID of the base field with their API key). */
  previous: SchemaDefinition | undefined;
  /** Every other definition as it would be after applying (for cross-definition checks). */
  others: readonly SchemaDefinition[];
};

const parseJson = (text: string): { ok: true; raw: unknown } | { ok: false; message: string } => {
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

export const analyzeFile = (text: string, { previous, others }: AnalyzeContext): FileAnalysis => {
  const json = parseJson(text);
  if (!json.ok) {
    return { status: 'invalidJson', message: json.message };
  }
  // New fields without an ID get one that works outside secure contexts too (plain-HTTP LAN installs).
  const parsed = parseDefinition(json.raw, { createId: newStableId, ...(previous ? { previous } : {}) });
  if (!parsed.ok) {
    return { status: 'invalid', raw: json.raw, issues: parsed.issues };
  }
  const { definition } = parsed;
  const cross = validateSchema([...others.filter((other) => other.id !== definition.id), definition]).filter(
    (found) => found.definitionId === undefined || found.definitionId === definition.id,
  );
  return cross.length > 0
    ? { status: 'invalid', raw: json.raw, issues: cross }
    : { status: 'valid', raw: json.raw, definition };
};

/** The issues to show in the editor (none for a JSON syntax error: the JSON linter reports it). */
export const issuesOf = (analysis: FileAnalysis): ValidationIssue[] =>
  analysis.status === 'invalid' ? analysis.issues : [];
