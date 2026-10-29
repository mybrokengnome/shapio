import type { ApprovalMode } from '@shapio/client';
import type { LucideIcon } from 'lucide-react';
import { useController, type Control } from 'react-hook-form';
import { RadioTile } from '@/components/RadioTile';
import { RadioGroup } from '@/components/ui/radio-group';
import { cn } from '@/helpers/cn';
import type { ApprovalSettingsValues } from '../helpers/workflowForm';

export type ModeOption = { value: ApprovalMode; label: string; description: string; icon: LucideIcon };

type ModeFieldProps = {
  control: Control<ApprovalSettingsValues>;
  label: string;
  options: readonly ModeOption[];
  disabled?: boolean;
};

/** Where approval comes from, as radio tiles: inherit the network default, off, or a workflow of its own. */
export const ModeField = ({ control, label, options, disabled }: ModeFieldProps) => {
  const { field } = useController({ control, name: 'mode' });
  return (
    <RadioGroup
      aria-label={label}
      value={field.value}
      onValueChange={field.onChange}
      disabled={disabled}
      className={cn(options.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}
    >
      {options.map((option) => (
        <RadioTile
          key={option.value}
          value={option.value}
          label={option.label}
          description={option.description}
          icon={option.icon}
          disabled={disabled}
        />
      ))}
    </RadioGroup>
  );
};
