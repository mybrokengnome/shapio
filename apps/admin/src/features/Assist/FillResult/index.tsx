import type { FieldFillResult } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FillReview } from '../FillReview';
import type { FieldFill } from '../hooks/useFieldFill';

type FillResultProps = {
  /** The model that proposed the values. */
  model: string;
  result: FieldFillResult;
  fill: FieldFill;
};

/** A finished fill run: "Review N proposals", which opens the review sheet, or why there is nothing. */
export const FillResult = ({ model, result, fill }: FillResultProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const count = result.proposals.length;
  return (
    <>
      {count > 0 ? (
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t('assist.fixes.review', { count })}
        </Button>
      ) : (
        <span className="text-meta text-muted-foreground">
          {result.skipped.length > 0
            ? t('assist.fill.noneSkipped', { count: result.skipped.length })
            : t('assist.fill.none')}
        </span>
      )}
      <FillReview
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            fill.finishReview();
          }
        }}
        model={model}
        result={result}
        fill={fill}
      />
    </>
  );
};
