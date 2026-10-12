import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

type OwnOnlyProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** The "only their own entries" switch of one granted action. */
export const OwnOnly = ({ id, checked, disabled, onCheckedChange }: OwnOnlyProps) => {
  const { t } = useTranslation();
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id}>{t('roles.matrix.ownOnly')}</FieldLabel>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </Field>
  );
};
