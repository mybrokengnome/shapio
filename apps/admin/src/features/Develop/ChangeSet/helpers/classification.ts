import type { ChangeKind, ClassifiedChange } from '@shapio/schema';
import type { StatusTone } from '@/components/StatusChip';

/**
 * How a schema change reads in a change set review: additive (live, nothing breaks), validation (existing
 * content is checked first), conversion (stored values are rewritten), breaking (the API contract changes or
 * data is lost; needs acknowledgement), metadata (labels, help text, editors).
 */
export const CHANGE_CLASSES = ['breaking', 'conversion', 'validation', 'additive', 'metadata'] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

const VALIDATION_CATEGORIES: ReadonlySet<string> = new Set([
  'requiredField',
  'validation',
  'constraint',
  'index',
]);
const METADATA_CATEGORIES: ReadonlySet<string> = new Set(['metadata', 'editorSwap']);

export const classOfChange = (change: ClassifiedChange): ChangeClass => {
  if (change.breaking || change.destructive) {
    return 'breaking';
  }
  if (change.category === 'conversion') {
    return 'conversion';
  }
  if (VALIDATION_CATEGORIES.has(change.category)) {
    return 'validation';
  }
  return METADATA_CATEGORIES.has(change.category) ? 'metadata' : 'additive';
};

export const CHANGE_CLASS_DISPLAY = {
  breaking: { labelKey: 'changes.classes.breaking', tone: 'warning' },
  conversion: { labelKey: 'changes.classes.conversion', tone: 'warning' },
  validation: { labelKey: 'changes.classes.validation', tone: 'neutral' },
  additive: { labelKey: 'changes.classes.additive', tone: 'success' },
  metadata: { labelKey: 'changes.classes.metadata', tone: 'muted' },
} as const satisfies Record<ChangeClass, { labelKey: string; tone: StatusTone }>;

const ADDED: ReadonlySet<ChangeKind> = new Set(['definition.added', 'field.added']);
const REMOVED: ReadonlySet<ChangeKind> = new Set(['definition.removed', 'field.removed']);

/** The diff gutter: `+` for something added, `−` for something removed, `~` for a change in place. */
export const signOfChange = (change: Pick<ClassifiedChange, 'kind'>): '+' | '−' | '~' => {
  if (ADDED.has(change.kind)) {
    return '+';
  }
  return REMOVED.has(change.kind) ? '−' : '~';
};
