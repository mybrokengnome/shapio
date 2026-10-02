import { cn } from '@/helpers/cn';

type JsonBlockProps = { value: unknown; label: string; className?: string };

/** Pretty-printed JSON (payloads, results), scrollable and focusable so keyboard users can scroll it. */
export const JsonBlock = ({ value, label, className }: JsonBlockProps) => (
  <pre
    tabIndex={0}
    aria-label={label}
    className={cn(
      'max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      className,
    )}
  >
    {typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
  </pre>
);
