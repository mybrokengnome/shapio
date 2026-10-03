import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { assistInvalidOutput } from './errors.js';
import type { AssistMessage, AssistProvider, CompletionRequest } from './providers/types.js';

/** Token usage and the answering model across the model calls of one assist run. */
export type UsageMeter = {
  inputTokens: number;
  outputTokens: number;
  /** The model the provider reported last; the configured model until the first answer. */
  model: string;
  calls: number;
};

export const createUsageMeter = (provider: AssistProvider): UsageMeter => ({
  inputTokens: 0,
  outputTokens: 0,
  model: provider.model,
  calls: 0,
});

type TextRequest = Omit<CompletionRequest, 'json'>;

const MAX_REPORTED_PROBLEMS = 10;

const call = async (provider: AssistProvider, meter: UsageMeter, request: CompletionRequest) => {
  const result = await provider.complete(request);
  meter.inputTokens += result.usage.inputTokens;
  meter.outputTokens += result.usage.outputTokens;
  meter.model = result.model;
  meter.calls += 1;
  return result;
};

/** A plain-text answer, trimmed. */
export const completeText = async (
  provider: AssistProvider,
  meter: UsageMeter,
  request: TextRequest,
): Promise<string> => (await call(provider, meter, request)).text.trim();

const schemaProblems = (schema: TSchema, value: unknown): string[] => {
  if (value === undefined) {
    return ['the answer was not a JSON object'];
  }
  return Value.Check(schema, value)
    ? []
    : [...Value.Errors(schema, value)].map((error) => `${error.instancePath || '/'} ${error.message}`);
};

/**
 * A JSON answer checked against `schema` and then `check` (problems a schema cannot express). One repair
 * turn sends the problems back; a second invalid answer is `502 ASSIST_INVALID_OUTPUT` with the problems.
 */
export const completeJson = async <T extends TSchema>(
  provider: AssistProvider,
  meter: UsageMeter,
  request: TextRequest & { name: string; schema: T },
  check: (value: Static<T>) => string[] = () => [],
): Promise<Static<T>> => {
  const { name, schema, ...rest } = request;
  let messages: readonly AssistMessage[] = rest.messages;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await call(provider, meter, { ...rest, messages, json: { name, schema } });
    problems = schemaProblems(schema, result.json);
    if (problems.length === 0) {
      problems = check(result.json as Static<T>);
    }
    if (problems.length === 0) {
      return result.json as Static<T>;
    }
    messages = [
      ...messages,
      { role: 'assistant', content: result.text },
      {
        role: 'user',
        content:
          `That answer is not valid:\n- ${problems.slice(0, MAX_REPORTED_PROBLEMS).join('\n- ')}\n` +
          'Answer again with the complete, corrected JSON object only.',
      },
    ];
  }
  throw assistInvalidOutput('The model did not return a valid answer, even after one correction', {
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
  });
};
