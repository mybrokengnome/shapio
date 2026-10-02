import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

type ClearButtonProps = { label: string; onClear: () => void; disabled?: boolean };

/** Empties a field whose control has no empty state of its own (select, radio, date). */
export const ClearButton = ({ label, onClear, disabled }: ClearButtonProps) => {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={t('content.fields.clearValue', { field: label })}
      onClick={onClear}
    >
      <X aria-hidden="true" />
    </Button>
  );
};
