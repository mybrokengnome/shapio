import { segmentsOf, type FakeLlmCall, type FakeLlmReply } from '../../../api/test/fixtures/fakeLlm';

/** What the fake model answers, so specs can assert on it. */
export const ASSIST_ANSWERS = {
  model: 'e2e-model',
  alt: 'Harbour lights reflected in calm water at night',
  rewrite: 'The harbour glowed as the fog rolled in.',
  /** A suggested string or text value is this prefix and the field's label ("Suggested Excerpt"). */
  suggestionPrefix: 'Suggested ',
  /** "Write…": Markdown with a heading, bold text and a list, so Insert's blocks can be checked. */
  section: '## Pricing\n\nPlans start **monthly** and go up from there.\n\n- Monthly\n- Yearly',
  continuation: 'By morning the fog had lifted and the boats were out.',
  translatePrefix: '[fr] ',
} as const;

/** What a suggested string or text value is for a field ("SEO › Title" for a component's field). */
export const suggestionFor = (fieldLabel: string) => `${ASSIST_ANSWERS.suggestionPrefix}${fieldLabel}`;

/**
 * A suggestion in the shape the prompt asks for: for an enum, the first allowed value as JSON
 * (`{"value": …}` or `{"values": […]}`); otherwise the field's label after a fixed prefix.
 */
const suggestion = (system: string): string => {
  const label = /the "(.+?)" field/.exec(system)?.[1] ?? 'value';
  const firstAllowed = /Allowed values \(value: label\): ([^:;]+):/.exec(system)?.[1]?.trim();
  if (firstAllowed !== undefined && system.includes('{"values"')) {
    return JSON.stringify({ values: [firstAllowed] });
  }
  if (firstAllowed !== undefined) {
    return JSON.stringify({ value: firstAllowed });
  }
  return suggestionFor(label);
};

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
  if (call.system.startsWith('You suggest a value for a field')) {
    return { text: suggestion(call.system) };
  }
  if (call.system.startsWith('You draft text for a document')) {
    return {
      text: call.system.includes('Write what the editor asked for')
        ? ASSIST_ANSWERS.section
        : ASSIST_ANSWERS.continuation,
    };
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
