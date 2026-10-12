import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';

type IssueCode = keyof typeof en.models.issues;

const isKnownCode = (code: string): code is IssueCode => Object.hasOwn(en.models.issues, code);

/** Codes for an API ID another definition already uses. */
const TAKEN_CODES: ReadonlySet<string> = new Set(['API_KEY_COLLISION', 'API_KEY_TAKEN']);

/** A choice field's settings, by where the problem is: more useful than "This setting isn't valid". */
const CHOICE_SETTINGS: ReadonlyArray<[RegExp, 'choicesEmpty' | 'choiceValue' | 'choiceLabel']> = [
  [/\/settings\/values$/, 'choicesEmpty'],
  [/\/settings\/values\/\d+\/value$/, 'choiceValue'],
  [/\/settings\/values\/\d+\/label$/, 'choiceLabel'],
];

/**
 * A translated message for a schema validation issue, by its stable code (the server's text otherwise). A
 * taken API ID found in a site's view names that site (`siteKey`, sent to every-site admins only); a choice
 * field's settings say which part is wrong (`path`).
 */
export const describeIssue = (issue: {
  code: string;
  message: string;
  siteKey?: string;
  path?: string;
}): string => {
  if (issue.siteKey && TAKEN_CODES.has(issue.code)) {
    return i18next.t('models.issues.apiKeyTakenOnSite', { site: issue.siteKey });
  }
  if (issue.code === 'INVALID_SETTINGS' && issue.path) {
    const choice = CHOICE_SETTINGS.find(([pattern]) => pattern.test(issue.path ?? ''));
    if (choice) {
      return i18next.t(`models.issues.${choice[1]}`);
    }
  }
  return isKnownCode(issue.code) ? i18next.t(`models.issues.${issue.code}`) : issue.message;
};
