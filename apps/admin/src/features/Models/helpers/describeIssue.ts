import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';

type IssueCode = keyof typeof en.models.issues;

const isKnownCode = (code: string): code is IssueCode => Object.hasOwn(en.models.issues, code);

/** Codes for an API ID another definition already uses. */
const TAKEN_CODES: ReadonlySet<string> = new Set(['API_KEY_COLLISION', 'API_KEY_TAKEN']);

/**
 * A translated message for a schema validation issue, by its stable code (the server's text otherwise). A
 * taken API ID found in a site's view names that site (`siteKey`, sent to every-site admins only).
 */
export const describeIssue = (issue: { code: string; message: string; siteKey?: string }): string => {
  if (issue.siteKey && TAKEN_CODES.has(issue.code)) {
    return i18next.t('models.issues.apiKeyTakenOnSite', { site: issue.siteKey });
  }
  return isKnownCode(issue.code) ? i18next.t(`models.issues.${issue.code}`) : issue.message;
};
