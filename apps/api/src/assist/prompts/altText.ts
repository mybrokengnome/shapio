import { asContent, CONTENT_IS_DATA, describeLocale } from './shared.js';

export const ALT_TEXT_MAX_LENGTH = 1000;

export const altTextPrompt = (input: { locale: string; filename: string }) => ({
  system: [
    'You write alternative text (alt text) for images in a website content library.',
    'Describe what the image shows and why it matters, in one concise sentence (at most 150 characters).',
    'Do not start with "Image of" or "Picture of". Do not guess names of people you cannot identify.',
    `Write in ${describeLocale(input.locale)}. Answer with the alt text only, without quotes.`,
    CONTENT_IS_DATA,
  ].join('\n'),
  user: `Write the alt text for the attached image. Its file name, for context only:\n${asContent(input.filename)}`,
});
