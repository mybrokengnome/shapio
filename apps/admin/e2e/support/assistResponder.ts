import { segmentsOf, type FakeLlmCall, type FakeLlmReply } from '../../../api/test/fixtures/fakeLlm';

/** What the fake model answers, so specs can assert on it. */
export const ASSIST_ANSWERS = {
  model: 'e2e-model',
  alt: 'Harbour lights reflected in calm water at night',
  rewrite: 'The harbour glowed as the fog rolled in.',
  summary: 'A night walk along a foggy harbour, lights coming on one by one.',
  translatePrefix: '[fr] ',
} as const;

/** Text in an instruction or description that makes the fake provider fail (to test inline errors). */
export const FAIL_TRIGGER = 'E2E_PROVIDER_FAIL';

const schemaDraft = {
  definitions: [
    {
      kind: 'collection',
      apiKey: 'recipe',
      label: 'Recipe',
      localized: false,
      titleField: 'name',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', required: true },
        { apiKey: 'cookingTime', label: 'Cooking time', type: 'integer' },
        { apiKey: 'steps', label: 'Steps', type: 'richtext' },
      ],
    },
  ],
};

/**
 * A deterministic model for the e2e assist server: each task (told apart by its system prompt) gets a fixed
 * answer in the shape the server expects; a request mentioning FAIL_TRIGGER gets a provider error.
 */
export const assistResponder = (call: FakeLlmCall): FakeLlmReply => {
  if (call.system.includes(FAIL_TRIGGER) || call.firstUserText.includes(FAIL_TRIGGER)) {
    return { status: 500, message: 'The fake provider failed on purpose' };
  }
  if (call.system.startsWith('You write alternative text')) {
    return { text: ASSIST_ANSWERS.alt };
  }
  if (call.system.startsWith('You rewrite')) {
    return { text: ASSIST_ANSWERS.rewrite };
  }
  if (call.system.includes("a summary of the entry's body")) {
    return { text: ASSIST_ANSWERS.summary };
  }
  if (call.system.startsWith('You translate')) {
    const segments = segmentsOf(call).map(({ id, text }) => ({
      id,
      text: `${ASSIST_ANSWERS.translatePrefix}${text}`,
    }));
    return { text: JSON.stringify({ segments }) };
  }
  if (call.system.startsWith('You design content models')) {
    return { text: JSON.stringify(schemaDraft) };
  }
  return { text: 'ok' };
};
