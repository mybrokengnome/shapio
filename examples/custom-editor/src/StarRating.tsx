import type { FieldEditorProps } from '@shapio/editor-sdk';
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';

const DEFAULT_STARS = 5;

/**
 * Styles use the admin's theme variables (`--primary`, `--border`, ...), so the editor follows light and
 * dark mode without shipping its own palette. Runtime editors are not part of the admin's Tailwind build,
 * so they style themselves.
 */
const styles = {
  group: { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
  star: (on: boolean, invalid: boolean): CSSProperties => ({
    width: '2.25rem',
    height: '2.25rem',
    fontSize: '1.5rem',
    lineHeight: 1,
    borderRadius: '0.375rem',
    border: `1px solid ${invalid ? 'var(--destructive)' : 'var(--border)'}`,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? 'var(--primary)' : 'var(--muted-foreground)',
    cursor: 'pointer',
  }),
  clear: {
    marginLeft: '0.5rem',
    border: 'none',
    background: 'transparent',
    color: 'var(--link)',
    textDecoration: 'underline',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.875rem',
  },
} as const;

/**
 * A star rating for `integer` fields: radio-group semantics (arrow keys move, Space/Enter choose), with a
 * clear button. The number of stars is the editor option `stars` (default 5). The field's own `min`/`max`
 * are enforced by the server, exactly as for the built-in number input.
 */
export const StarRating = ({
  inputId,
  labelId,
  describedBy,
  value,
  onChange,
  onBlur,
  validation,
  readOnly,
  disabled,
  field,
  context,
}: FieldEditorProps<'integer'>) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const stars = typeof field.options.stars === 'number' ? field.options.stars : DEFAULT_STARS;
  const current = typeof value === 'number' ? value : 0;
  const inert = readOnly || disabled;
  const choose = (rating: number) => {
    if (!inert) {
      onChange(rating);
    }
  };
  const onKeyDown = (event: KeyboardEvent, rating: number) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? rating + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? rating - 1
          : 0;
    if (next >= 1 && next <= stars) {
      event.preventDefault();
      choose(next);
      buttons.current[next - 1]?.focus();
    }
  };
  const starLabel = (rating: number) =>
    context.translate('acme.starRating.star', rating === 1 ? '{{count}} star' : '{{count}} stars', {
      count: rating,
    });
  return (
    <div
      id={inputId}
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={validation.invalid || undefined}
      aria-readonly={readOnly || undefined}
      aria-disabled={disabled || undefined}
      style={styles.group}
      onBlur={onBlur}
    >
      {Array.from({ length: stars }, (_, index) => {
        const rating = index + 1;
        const checked = rating === current;
        return (
          <button
            key={rating}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={starLabel(rating)}
            tabIndex={checked || (current === 0 && rating === 1) ? 0 : -1}
            disabled={disabled}
            style={styles.star(rating <= current, validation.invalid)}
            onClick={() => choose(rating)}
            onKeyDown={(event) => onKeyDown(event, rating)}
          >
            {rating <= current ? '★' : '☆'}
          </button>
        );
      })}
      {current > 0 && !inert ? (
        <button type="button" style={styles.clear} onClick={() => onChange(null)}>
          {context.translate('common.clear', 'Clear')}
        </button>
      ) : null}
    </div>
  );
};
