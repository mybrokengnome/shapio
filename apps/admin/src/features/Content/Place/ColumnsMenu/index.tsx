import type { FieldDefinition } from '@shapio/schema';
import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ColumnsMenuProps = {
  choices: readonly FieldDefinition[];
  columns: readonly FieldDefinition[];
  customized: boolean;
  onColumnChange: (fieldId: string, visible: boolean) => void;
  onReset: () => void;
};

/** Which fields the list shows as columns (at least one stays). */
export const ColumnsMenu = ({ choices, columns, customized, onColumnChange, onReset }: ColumnsMenuProps) => {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3 aria-hidden="true" />
          {t('place.list.columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>{t('place.list.columnsTitle')}</DropdownMenuLabel>
        {choices.map((field) => {
          const visible = columns.includes(field);
          return (
            <DropdownMenuCheckboxItem
              key={field.id}
              checked={visible}
              disabled={visible && columns.length === 1}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onColumnChange(field.id, checked === true)}
            >
              {field.label}
            </DropdownMenuCheckboxItem>
          );
        })}
        {customized ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>{t('place.list.resetColumns')}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
