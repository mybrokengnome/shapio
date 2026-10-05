import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

type AddItemButtonProps = {
  /** The component's label: "Add {label}". */
  item: string;
  onAdd: () => void;
  /** `outline` in forms and empty states; `ghost` at the end of a canvas list, like the canvas's own `+`. */
  variant?: 'outline' | 'ghost';
  className?: string;
};

/** "Add Text item": adds one more of a component to a list, or the component to an empty single field. */
export const AddItemButton = ({ item, onAdd, variant = 'outline', className }: AddItemButtonProps) => {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={cn(variant === 'ghost' && '-ml-2 text-muted-foreground', className)}
      onClick={onAdd}
    >
      <Plus aria-hidden="true" />
      {t('content.items.add', { item })}
    </Button>
  );
};
