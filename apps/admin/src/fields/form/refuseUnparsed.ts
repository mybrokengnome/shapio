import { toast } from 'sonner';
import { i18next } from '@/app/i18n';
import { unparsedPathsOf } from '../helpers/unparsed';
import type { EntryFormStore } from './store';

/**
 * Before Save, Create or Publish: when an editor still holds text that doesn't parse, nothing is sent.
 * Every field's messages are revealed and a toast says how many need attention. Returns true when refused.
 */
export const refuseUnparsed = (store: EntryFormStore): boolean => {
  const count = unparsedPathsOf(store.getState().values).length;
  if (count === 0) {
    return false;
  }
  store.getState().reveal();
  toast.error(i18next.t('content.form.fixProblems', { count }));
  return true;
};
