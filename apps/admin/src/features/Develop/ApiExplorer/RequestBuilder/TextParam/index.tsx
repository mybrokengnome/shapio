import { useId, type ComponentProps } from 'react';
import { HintedLabel } from '@/components/HintedLabel';
import { Input } from '@/components/ui/input';
import { cn } from '@/helpers/cn';

type TextParamProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
} & Pick<ComponentProps<typeof Input>, 'type' | 'inputMode' | 'placeholder' | 'required' | 'autoComplete'>;

/** One request parameter: a labelled input, with the parameter's explanation behind an info icon. */
export const TextParam = ({ label, hint, value, onChange, mono = false, ...inputProps }: TextParamProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="min-w-0 space-y-2">
      <HintedLabel htmlFor={id} label={label} hint={hint} hintId={hint ? hintId : undefined} />
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
        className={cn(mono && 'font-mono')}
        spellCheck={false}
        {...inputProps}
      />
    </div>
  );
};
