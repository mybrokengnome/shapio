import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';

type IssueCode = keyof typeof en.models.issues;

const isKnownCode = (code: string): code is IssueCode => Object.hasOwn(en.models.issues, code);

/** A translated message for a schema validation issue, by its stable code (the server's text otherwise). */
export const describeIssue = (issue: { code: string; message: string }): string =>
  isKnownCode(issue.code) ? i18next.t(`models.issues.${issue.code}`) : issue.message;
