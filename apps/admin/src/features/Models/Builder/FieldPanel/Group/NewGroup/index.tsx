import { MAX_LABEL_LENGTH } from '@shapio/schema';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type NewGroupProps = {
  id: string;
  disabled: boolean;
  onCreate: (label: string) => void;
  onCancel: () => void;
};

/** Names a new group inline: Enter or Create adds it, Escape or Cancel goes back to the select. */
export const NewGroup = ({ id, disabled, onCreate, onCancel }: NewGroupProps) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const trimmed = label.trim();
  const create = () => {
    if (trimmed) {
      onCreate(trimmed);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      create();
    } else if (event.key === 'Escape') {
      // Handled here, so the field panel doesn't take it as "discard this new field".
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('models.builder.groupName')}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={label}
          autoComplete="off"
          maxLength={MAX_LABEL_LENGTH}
          autoFocus
          disabled={disabled}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" size="sm" disabled={disabled || !trimmed} onClick={create}>
          {t('common.create')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </Field>
  );
};
