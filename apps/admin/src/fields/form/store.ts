import type { ContentIssue } from '@shapio/client';
import { createStore } from 'zustand/vanilla';
import { dirtyKeysOf, mergeSaved } from '../helpers/formValues';
import type { FormValues } from '../helpers/values';

/**
 * State of one entry form: the values being edited, the baseline they are compared with (what the server
 * last returned), and validation issues. One store per open form (the page's form and an inline-create
 * drawer each have their own), so fields subscribe to just their own value.
 */
export type EntryFormState = {
  values: FormValues;
  baseline: FormValues;
  /** Server issues from the last save, plus none of the client-side checks (computed per field). */
  issues: readonly ContentIssue[];
  /** Paths whose client-side checks are shown (after the field was left, or after a save attempt). */
  touched: ReadonlySet<string>;
  /** Show every field's client-side issues (set by a save or publish attempt). */
  revealAll: boolean;
  setValue: (apiKey: string, value: unknown) => void;
  /** Replaces several values at once (copy from another locale, reload keeping local edits). */
  patchValues: (values: FormValues) => void;
  touch: (path: string) => void;
  reveal: () => void;
  setIssues: (issues: readonly ContentIssue[]) => void;
  /** Starts over from values loaded from the server. */
  load: (values: FormValues) => void;
  /** Rebases onto newly loaded values, keeping these local changes on top. */
  rebase: (values: FormValues, local: FormValues) => void;
  /** Accepts a save's result; see `mergeSaved`. */
  acceptSaved: (sent: FormValues, saved: FormValues) => void;
};

export type EntryFormStore = ReturnType<typeof createEntryFormStore>;

const withoutIssuesUnder = (issues: readonly ContentIssue[], apiKey: string) => {
  const prefix = `/${apiKey}`;
  return issues.filter((issue) => issue.path !== prefix && !issue.path.startsWith(`${prefix}/`));
};

export const createEntryFormStore = (initial: FormValues) =>
  createStore<EntryFormState>()((set) => ({
    values: initial,
    baseline: initial,
    issues: [],
    touched: new Set(),
    revealAll: false,
    setValue: (apiKey, value) =>
      set((state) => ({
        values: { ...state.values, [apiKey]: value },
        // A changed value makes the server's verdict on it stale.
        issues: withoutIssuesUnder(state.issues, apiKey),
      })),
    patchValues: (values) =>
      set((state) => ({
        values: { ...state.values, ...values },
        issues: Object.keys(values).reduce(withoutIssuesUnder, state.issues),
      })),
    touch: (path) =>
      set((state) => (state.touched.has(path) ? state : { touched: new Set([...state.touched, path]) })),
    reveal: () => set({ revealAll: true }),
    setIssues: (issues) => set({ issues }),
    load: (values) => set({ values, baseline: values, issues: [], touched: new Set(), revealAll: false }),
    rebase: (values, local) => set({ values: { ...values, ...local }, baseline: values, issues: [] }),
    acceptSaved: (sent, saved) => set((state) => mergeSaved(state.values, sent, saved)),
  }));

/** Top-level API keys with unsaved changes. */
export const selectDirtyKeys = (state: Pick<EntryFormState, 'values' | 'baseline'>) =>
  dirtyKeysOf(state.values, state.baseline);
