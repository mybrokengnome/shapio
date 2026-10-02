import type { MediaFocalPoint } from '@shapio/client';
import { Crosshair } from 'lucide-react';
import { useId, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type FocalPointProps = {
  imageUrl: string;
  value: MediaFocalPoint | null;
  onChange: (value: MediaFocalPoint | null) => void;
};

const PERCENT = 100;
const CENTRE: MediaFocalPoint = { x: 0.5, y: 0.5 };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The point crops keep in view. Click the image to place it; the percentage inputs are the keyboard path
 * (the image itself is a pointer shortcut and hidden from assistive technology).
 */
export const FocalPoint = ({ imageUrl, value, onChange }: FocalPointProps) => {
  const { t } = useTranslation();
  // Unique per instance: the media details sheet and the entry's settings drawer can both show one.
  const id = useId();
  const point = value ?? CENTRE;
  const place = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onChange({
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    });
  };
  const setAxis = (axis: 'x' | 'y', text: string) => {
    const number = Number(text);
    if (text !== '' && Number.isFinite(number)) {
      onChange({ ...point, [axis]: clamp(number / PERCENT) });
    }
  };
  return (
    <FieldSet aria-labelledby={`${id}-title`}>
      <FieldLegend variant="label" className="flex items-center gap-1">
        <span id={`${id}-title`}>{t('media.focal.title')}</span>
        <InfoHint about={t('media.focal.title')}>{t('media.focal.hint')}</InfoHint>
      </FieldLegend>
      <div
        aria-hidden="true"
        onClick={place}
        className="relative w-fit max-w-full cursor-crosshair overflow-hidden rounded-lg border"
        style={
          { '--focal-x': `${point.x * PERCENT}%`, '--focal-y': `${point.y * PERCENT}%` } as CSSProperties
        }
      >
        <img src={imageUrl} alt="" className="block max-h-64 w-auto" draggable={false} />
        {value ? (
          <span className="absolute top-[var(--focal-y)] left-[var(--focal-x)] flex size-6 -translate-1/2 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow">
            <Crosshair className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-28">
          <FieldLabel htmlFor={`${id}-x`}>{t('media.focal.x')}</FieldLabel>
          <Input
            id={`${id}-x`}
            type="number"
            min={0}
            max={PERCENT}
            step={1}
            value={value ? Math.round(value.x * PERCENT) : ''}
            placeholder={t('media.focal.unset')}
            onChange={(event) => setAxis('x', event.target.value)}
          />
        </Field>
        <Field className="w-28">
          <FieldLabel htmlFor={`${id}-y`}>{t('media.focal.y')}</FieldLabel>
          <Input
            id={`${id}-y`}
            type="number"
            min={0}
            max={PERCENT}
            step={1}
            value={value ? Math.round(value.y * PERCENT) : ''}
            placeholder={t('media.focal.unset')}
            onChange={(event) => setAxis('y', event.target.value)}
          />
        </Field>
        <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => onChange(null)}>
          {t('media.focal.clear')}
        </Button>
      </div>
    </FieldSet>
  );
};
